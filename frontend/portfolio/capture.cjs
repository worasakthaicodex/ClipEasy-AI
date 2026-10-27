// Capture the real React editor inside Electron with the isolated portfolio data.
// Run with Vite and the local backend running:
// electron portfolio/capture.cjs <absolute demo-video path>
const { app, BrowserWindow, Menu } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const output = path.resolve(__dirname, '../../docs/screenshots');
const report = path.resolve(__dirname, '../../_work/portfolio/capture-result.json');
app.setPath('userData', path.resolve(__dirname, '../../_work/portfolio-capture-user-data'));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const shots = [];
app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  const win = new BrowserWindow({ width: 1600, height: 1000, show: false, backgroundColor: '#14161a',
    webPreferences: { offscreen: true, backgroundThrottling: false } });
  const run = source => win.webContents.executeJavaScript(source, true);
  const until = async (source, name) => {
    const end = Date.now() + 20000;
    while (Date.now() < end) { if (await run(source)) return; await delay(80); }
    throw new Error(`Not ready: ${name}`);
  };
  const capture = async name => {
    await run('document.fonts.ready'); await delay(500);
    fs.writeFileSync(path.join(output, name + '.png'), (await win.webContents.capturePage()).toPNG());
    shots.push(name);
  };
  const clickText = async (selector, text) => {
    await run(`[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent.includes(${JSON.stringify(text)})).click()`);
  };
  try {
    fs.mkdirSync(output, { recursive: true });
    await win.loadURL(`http://127.0.0.1:5173/portfolio/?video=${encodeURIComponent(process.argv[2] || path.resolve(__dirname, '../../_work/portfolio/city-demo.mp4'))}`);
    await until("document.querySelector('.recent-row')", 'home');
    await capture('home');
    await run("document.querySelector('.recent-row').click()");
    await until("document.querySelector('.monitor-video')?.readyState>=2", 'video');
    await run("document.querySelector('.monitor-video').currentTime=3");
    await until("!document.querySelector('.monitor-video').seeking", 'video seek');
    await run("document.querySelector('.track-lane[data-track=\"1\"] .clip-block.video').dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,clientX:450,clientY:700}));window.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}))");
    for (let i=0; i<4; i++) { await run("document.querySelector('button[title=\"ซูมเข้า\"]').click()"); await delay(80); }
    await run("document.querySelector('.timeline-tracks').dispatchEvent(new WheelEvent('wheel',{bubbles:true,deltaY:-100000}))");
    await clickText('.properties-panel .prop-group-head', 'Video');
    await delay(1500);
    await capture('editor');
    await clickText('.anim-sidebar .anim-side-item', 'ปรับสี');
    await clickText('.color-grade-card', 'Cinema Gold');
    await clickText('.properties-panel .panel-tab', 'Effect & Animate');
    await capture('effects');
    await clickText('.topbar-tab', 'Export');
    await until("document.querySelector('.export-preview-stage .monitor-video')?.readyState>=2", 'export');
    await run("document.querySelector('.monitor-video').currentTime=3");
    await until("!document.querySelector('.monitor-video').seeking", 'export seek');
    await delay(300);
    if (!(await run("(()=>{const p=document.querySelector('.export-preview-pane').getBoundingClientRect(),v=document.querySelector('.export-preview-stage .monitor-content').getBoundingClientRect();return v.right<=p.right+1 && v.width<=p.width+1;})()"))) throw new Error('Export preview overflows its pane');
    await capture('export');
    await clickText('.topbar-tab', 'Edit');
    await until("document.querySelector('button[title=\"ตั้งค่า (AI Engines)\"]')", 'edit');
    await run("document.querySelector('button[title=\"ตั้งค่า (AI Engines)\"]').click()");
    await until("document.querySelector('.settings-nav')", 'settings');
    await clickText('.settings-nav .nav-item', 'Appearance');
    await capture('settings');
    fs.writeFileSync(report, JSON.stringify({ passed: true, screenshots: shots }, null, 2));
    app.exit(0);
  } catch (error) {
    fs.writeFileSync(report, JSON.stringify({ passed: false, screenshots: shots, error: error.stack }, null, 2));
    app.exit(1);
  }
});
