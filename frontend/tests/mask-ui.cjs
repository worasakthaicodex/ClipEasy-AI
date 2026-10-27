const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const output = path.join(__dirname, 'output');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.resolve(__dirname, '../../_work/mask-ui-user-data'));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
const checks = [], errors = [];
let win;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = text => fs.appendFileSync(path.join(output, 'mask-ui-log.txt'), `${new Date().toISOString()} ${text}\n`);
fs.writeFileSync(path.join(output, 'mask-ui-log.txt'), 'Starting UI test\n');
const bounded = (promise, label, ms = 15000) => Promise.race([promise, sleep(ms).then(() => { throw new Error(`Timed out: ${label}`); })]);
const js = code => bounded(win.webContents.executeJavaScript(code, true), code.slice(0, 120));
async function until(code, label, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (await js(code)) return; await sleep(80); }
  throw new Error(`Timeout: ${label}`);
}
async function click(selector) { await js(`document.querySelector(${JSON.stringify(selector)}).click()`); await sleep(80); }
async function clickText(selector, text) { await js(`[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent.includes(${JSON.stringify(text)})).click()`); await sleep(80); }
async function point(x, y, type = 'mouseMove', clickCount = 1) {
  win.webContents.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount });
  await sleep(25);
}
async function coords(x, y) {
  return js(`(()=>{ const s=document.querySelector('.mask-surface.editing [data-mask-editor]');const p=new DOMPoint(${x},${y}).matrixTransform(s.getScreenCTM()); return {x:p.x,y:p.y}; })()`);
}
async function drag(from, to) {
  const a = await coords(...from), b = await coords(...to);
  await point(a.x, a.y); await point(a.x, a.y, 'mouseDown');
  for (let i = 1; i <= 8; i++) await point(a.x + (b.x-a.x)*i/8, a.y + (b.y-a.y)*i/8);
  await point(b.x, b.y, 'mouseUp'); await sleep(150);
}
async function save() { await js('window.__saveNow()'); return js('window.__saved.data.sequence[0]'); }
async function setNumber(label, value) {
  const selector = `([...document.querySelectorAll('.mask-fx-field')].find(e=>e.textContent.includes(${JSON.stringify(label)})).querySelector('input[type=number]'))`;
  await js(`(()=>{const el=${selector};el.focus();el.select();})()`);
  await win.webContents.insertText(String(value));
  // Hidden offscreen windows do not always emit native focusout on blur.
  await sleep(80); await js(`(()=>{const el=${selector};el.dispatchEvent(new FocusEvent('focusout',{bubbles:true}));el.blur();})()`); await sleep(80);
}
function pass(name) { checks.push(name); log(`PASS ${name}`); console.log('PASS', name); }
app.whenReady().then(async () => {
  log('App ready');
  win = new BrowserWindow({ width: 1440, height: 1000, show: false, webPreferences: { offscreen: true, backgroundThrottling: false } });
  win.webContents.on('dom-ready', () => log('DOM ready'));
  win.webContents.on('render-process-gone', (_event, details) => log(`Renderer exited ${JSON.stringify(details)}`));
  win.webContents.on('console-message', (_e, level, msg) => { if (level >= 3 && !msg.includes('ERR_CONNECTION_REFUSED')) errors.push(msg); });
  try {
    const source = path.join(output, 'mask-fixture.mp4');
    await bounded(win.loadURL(`http://127.0.0.1:5173/tests/mask-app.html?source=${encodeURIComponent(source)}`), 'load page');
    log('Page loaded');
    await until("document.querySelector('.recent-row')", 'home');
    await click('.recent-row');
    await until("document.querySelector('.monitor-video')?.readyState >= 2", 'video load');
    // Select clip through its real timeline mousedown handler.
    await js("document.querySelector('.clip-block.video').dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,clientX:450,clientY:700}))");
    await js("window.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}))");
    await click('.tools-panel button[title^="วาด Mask"]');
    await until("document.querySelector('.mask-surface.editing')", 'mask mode');
    await until("document.querySelector('[data-mask-editor]').getBoundingClientRect().width > 100", 'geometry');
    win.webContents.focus();
    await js("window.__pointerEvents=[]; for(const type of ['pointerdown','pointermove','pointerup']) document.addEventListener(type,e=>window.__pointerEvents.push({type,x:e.clientX,y:e.clientY,target:e.target.tagName}),true)");
    const pathPoints = [[.34,.27],[.43,.27],[.52,.27],[.52,.45],[.52,.68],[.43,.68],[.34,.68],[.34,.45],[.34,.27]];
    let p = await coords(...pathPoints[0]); await point(p.x,p.y); await point(p.x,p.y,'mouseDown');
    for (const q of pathPoints.slice(1)) { p=await coords(...q); await point(p.x,p.y); }
    await point(p.x,p.y,'mouseUp');
    await until("document.querySelectorAll('[data-mask-point]').length >= 3", 'saved editable polygon');
    const first = await save();
    assert.ok(first.transform.fxMaskPath.length >= 3);
    assert.ok(await js("document.querySelector('.mask-surface.editing') && document.querySelector('.monitor-video').paused"));
    pass('draw persists with editable handles; tool stays active');
    await js("document.querySelector('.monitor-video').click(); document.querySelector('.monitor-video').play().catch(()=>{})");
    await sleep(150);
    assert.equal(await js("document.querySelector('.monitor-video').paused"),true);
    pass('mask blocks direct click and native play');
    const original=first.transform.fxMaskPath[1];
    await drag([original.x,original.y],[original.x+.04,original.y+.02]);
    const edited = await save();
    assert.ok(Math.abs(edited.transform.fxMaskPath[1].x-original.x-.04)<.01);
    pass('point drag edits normalized source coordinates');
    const a=edited.transform.fxMaskPath[0], b=edited.transform.fxMaskPath[1];
    p=await coords((a.x+b.x)/2,(a.y+b.y)/2);
    for(let i=1;i<=2;i++){await point(p.x,p.y,'mouseDown',i);await point(p.x,p.y,'mouseUp',i);}
    await sleep(180);
    assert.equal((await save()).transform.fxMaskPath.length,edited.transform.fxMaskPath.length+1);
    win.webContents.sendInputEvent({type:'keyDown',keyCode:'Delete'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Delete'});await sleep(150);
    assert.equal((await save()).transform.fxMaskPath.length,edited.transform.fxMaskPath.length);
    pass('double click adds a point and Delete removes selected point');
    const beforeMove=(await save()).transform.fxMaskPath;
    await drag([.43,.45],[.45,.46]);
    const afterMove=(await save()).transform.fxMaskPath;
    assert.ok(afterMove.every((p,i)=>Math.abs(p.x-beforeMove[i].x-.02)<.01 && Math.abs(p.y-beforeMove[i].y-.01)<.01));
    pass('dragging polygon moves the full mask without changing its shape');
    const beforeResize=(await save()).transform.fxMaskPath;
    win.setSize(1200,850);await sleep(220);
    assert.deepEqual((await save()).transform.fxMaskPath,beforeResize);
    pass('resize preserves mask source geometry');
    await click('.tools-panel button[title="Selection (V)"]');
    assert.equal(await js("!!document.querySelector('.mask-surface.editing')"),false);
    await clickText('.properties-panel .panel-tab','Effect & Animate');
    await until("document.querySelector('.mask-fx-controls')",'mask controls');
    await click('[aria-label="ซ่อนเส้น Mask"]');
    assert.equal(await js("getComputedStyle(document.querySelector('.mask-surface')).display"),'none');
    await click('[aria-label="แสดงเส้น Mask"]');
    pass('switching tool exits mode; guide hide/show works');
    await setNumber('ขนาดสูงสุด',200);
    await setNumber('ขอบนุ่ม',2);
    await setNumber('เวลาเริ่ม',.1);
    const settings=(await save()).transform.maskFx;
    assert.equal(settings.scale,200);assert.equal(settings.feather,.02);assert.equal(settings.start,.1);
    pass('size, feather and start controls update actual saved effect settings');
    // Advance to hold phase and verify changed pixels directly on rendered output.
    await js("document.querySelector('.monitor-video').currentTime=.8");
    await until("!document.querySelector('.monitor-video').seeking && document.querySelector('.monitor-video').currentTime > .7",'seek hold');
    await sleep(200);
    const delta=await js(`(()=>{const v=document.querySelector('.monitor-video'), c=document.querySelector('[data-mask-render]'); const b=document.createElement('canvas');b.width=c.width;b.height=c.height;const ctx=b.getContext('2d');ctx.drawImage(v,0,0,b.width,b.height);const a=ctx.getImageData(0,0,b.width,b.height).data,d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=0;i<a.length;i+=4)if(Math.abs(a[i]-d[i])+Math.abs(a[i+1]-d[i+1])+Math.abs(a[i+2]-d[i+2])>30)n++;return n;})()`);
    assert.ok(delta>150,`expanded image differs only ${delta} pixels`); pass('mask expansion changes actual preview pixels');
    await clickText('.mask-fx-track','ติดตาม');
    await until("document.querySelector('.mask-fx-success') || document.querySelector('.mask-fx-warning') || document.querySelector('.mask-fx-error')",'real tracking job',45000);
    assert.equal(await js("document.querySelector('.mask-fx-error')?.textContent || ''"),'');
    const tracked=await save(); assert.ok(tracked.transform.fxMaskTrack.length>=50); pass('UI submits actual tracking job and saves source-time matrices');
    await sleep(200);
    const preview=await js("document.querySelector('[data-mask-render]').toDataURL()");
    const raw=await js("(()=>{const v=document.querySelector('.monitor-video'),c=document.createElement('canvas');c.width=v.videoWidth;c.height=v.videoHeight;c.getContext('2d').drawImage(v,0,0);return c.toDataURL();})()");
    fs.writeFileSync(path.join(output,'mask-preview.png'),Buffer.from(preview.split(',')[1],'base64'));
    fs.writeFileSync(path.join(output,'mask-preview-source.png'),Buffer.from(raw.split(',')[1],'base64'));
    fs.writeFileSync(path.join(output,'mask-preview-state.json'),JSON.stringify({transform:tracked.transform,sourceTime:.8,localTime:.8}));
    await clickText('.topbar-tab','Export');
    await until("document.querySelector('.export-preview-stage .monitor-video')?.readyState >= 2",'output preview');
    await js("document.querySelector('.monitor-video').currentTime=.8"); await sleep(350);
    assert.equal(await js("document.querySelectorAll('.mask-editor-toolbar').length"),0);
    assert.equal(await js("document.querySelector('[data-mask-render]').toDataURL()"),preview);
    pass('Output preview uses exact same rendered mask frame as Edit');
    await click('.export-submit-btn');
    await until("window.__exported || document.querySelector('.export-error')",'real encoded export',60000);
    assert.equal(await js("document.querySelector('.export-error')?.textContent || ''"),'');
    const exported=await js('window.__exported');assert.ok(fs.statSync(exported.path).size>1000);
    fs.copyFileSync(exported.path,path.join(output,'mask-ui-export.mp4'));
    pass('Export button completes the actual backend encoding job');
    await clickText('.topbar-tab','Edit');await until("document.querySelector('.tools-panel')",'edit return');
    await js('window.__goHome()');await until("document.querySelector('.recent-row')",'home return');await click('.recent-row');
    await until("document.querySelector('.monitor-video')?.readyState >= 2",'reopen');
    assert.deepEqual((await save()).transform,tracked.transform);pass('App save/reopen preserves mask and tracking');
    await js('window.__goHome()');await until("document.querySelector('.recent-row')",'overlay test home');
    await js(`(()=>{const base=window.__saved.data.sequence[0];window.__saved.data.sequence=[{...base,transform:{}},{...base,id:'mask-overlay',name:'Rotated overlay',track:2,transform:{...base.transform,fxMaskPath:[{x:.3,y:.3},{x:.6,y:.3},{x:.45,y:.7}],fxMaskTrack:[],rotation:20,flipH:true,scale:80}}];})()`);
    await click('.recent-row');await until("document.querySelector('.pip-box video')?.readyState>=2",'overlay loaded');
    await js("document.querySelector('.track-lane[data-track=\"2\"] .clip-block.video').dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,clientX:450,clientY:700}));window.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}))");
    await click('.tools-panel button[title^="วาด Mask"]');
    await until("document.querySelector('.pip-box .mask-surface.editing')",'overlay editing');
    await drag([.3,.3],[.32,.32]);
    await save();
    const overlay=await js("window.__saved.data.sequence.find(c=>c.id==='mask-overlay')");
    assert.ok(Math.abs(overlay.transform.fxMaskPath[0].x-.32)<.01);
    assert.ok(Math.abs(overlay.transform.fxMaskPath[0].y-.32)<.01);
    pass('V2 mask point editing follows rotated and flipped source coordinates');
    win.webContents.sendInputEvent({type:'keyDown',keyCode:'Delete'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Delete'});await sleep(100);
    await save();assert.equal(await js("window.__saved.data.sequence.find(c=>c.id==='mask-overlay')?.transform.fxMaskPath.length"),3);
    pass('Delete at the three-point minimum cannot delete the timeline clip');
    await js("document.querySelector('.pip-box video').play().catch(()=>{});document.querySelector('.monitor-video').dispatchEvent(new Event('ended'))");await sleep(150);
    assert.ok(await js("document.querySelector('.pip-box video').paused && document.querySelector('.mask-surface.editing')"));
    win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});await sleep(100);
    assert.equal(await js("!!document.querySelector('.mask-surface.editing')"),false);
    pass('overlay native playback and clip end cannot escape Mask mode; Escape exits');
    assert.deepEqual(await js('window.__errors'),[]);
    fs.writeFileSync(path.join(output,'mask-ui.png'),(await win.webContents.capturePage()).toPNG());
    fs.writeFileSync(path.join(output,'mask-ui-result.json'),JSON.stringify({passed:true,checks,errors},null,2));
    console.log(JSON.stringify({passed:true,checks})); app.exit(0);
  } catch(e) {
    log(e.stack);
    try { log(JSON.stringify(await js('window.__pointerEvents'))); } catch {}
    if(win){try { fs.writeFileSync(path.join(output,'mask-ui-failure.png'),(await bounded(win.webContents.capturePage(), 'failure screenshot', 2000)).toPNG()); } catch {} }
    fs.writeFileSync(path.join(output,'mask-ui-result.json'),JSON.stringify({passed:false,checks,error:e.stack,errors},null,2));
    console.error(e);app.exit(1);
  }
});
