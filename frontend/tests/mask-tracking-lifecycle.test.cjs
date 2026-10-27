const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { parse } = require("@babel/parser");

// Exercise the real App callbacks with controllable network timing. Extracting
// function declarations avoids mounting the unrelated editor/engine UI in Node.
const source = fs.readFileSync(path.join(__dirname, "../src/App.jsx"), "utf8");
const ast = parse(source, { sourceType: "module", plugins: ["jsx"] });
const app = ast.program.body.find(node => node.type === "ExportDefaultDeclaration").declaration;
const names = ["selectTool", "openMaskEditor", "commitMask", "deleteMask", "maskTrackInputKey", "maskTrackClip",
  "stopMaskTrack", "resetMaskSession", "trackMask", "cancelMaskTrack", "updateSeqClip"];
const functions = names.map(name => {
  const node = app.body.body.find(node => node.type === "FunctionDeclaration" && node.id.name === name);
  assert.ok(node, `${name} must exist in App.jsx`);
  return source.slice(node.start, node.end);
}).join("\n");
const flush = () => new Promise(resolve => setImmediate(resolve));
const clone = value => JSON.parse(JSON.stringify(value));
const reply = value => ({ ok: true, json: async () => value });
const maskPath = [{ x: .2, y: .2 }, { x: .4, y: .2 }, { x: .3, y: .6 }];
const tracked = [{ time: 0, matrix: [1, 0, 0, 1, .1, .2] }];

function harness() {
  const requests = [], timers = [], statuses = [];
  const clip = { id: "v1", path: "clip.mp4", offset: 0, inPoint: 0, duration: 2, speed: 1,
    transform: { fxMaskPath: clone(maskPath), fxMaskTime: .5, maskFx: { scale: 170 } } };
  const context = vm.createContext({
    BACKEND_URL: "http://test", AbortController,
    maskTrackRun: { current: null }, maskProjectSession: { current: 0 },
    sequenceRef: { current: [clip] }, sequence: [clip], selectedId: clip.id,
    playback: { time: 0 }, tool: "mask", maskRedraw: 0, status: null,
    programControl: { current: { pause() {}, seekTo() {} } },
    setMaskTrackJob(value) { context.status = typeof value === "function" ? value(context.status) : value; statuses.push(context.status); },
    setSequence(value) { context.sequence = typeof value === "function" ? value(context.sequence) : value; context.sequenceRef.current = context.sequence; },
    setMaskRedraw(value) { context.maskRedraw = typeof value === "function" ? value(context.maskRedraw) : value; },
    setTool(value) { context.tool = value; }, setSelectedId(value) { context.selectedId = value; }, setCopiedStyle() {},
    hasMask: transform => transform?.fxMaskPath?.length >= 3,
    maskControlSettings: transform => ({ ...transform.maskFx }),
    maskBounds: () => ({ x: .2, y: .2, w: .2, h: .4 }),
    maskMatrixAt: () => [1, 0, 0, 1, 0, 0], transformPoint: point => point,
    setTimeout(callback) { timers.push(callback); },
    fetch(url, options = {}) {
      if (url.endsWith("/cancel")) { requests.push({ url, options }); return Promise.resolve(reply({ ok: true })); }
      return new Promise((resolve, reject) => requests.push({ url, options, resolve, reject }));
    },
  });
  new vm.Script(functions).runInContext(context);
  return { context, clip, requests, statuses,
    async advance() { assert.ok(timers.length, "tracking should be waiting to poll"); timers.shift()(); await flush(); },
  };
}

test("late start response from a closed project is cancelled without touching a new project with the same clip id", async () => {
  const h = harness(), c = h.context;
  const old = c.trackMask(h.clip);
  c.resetMaskSession();
  c.setSequence([clone(h.clip)]);
  const current = c.trackMask(c.sequence[0]);
  const newStatus = c.status;
  h.requests[0].resolve(reply({ job_id: "old-project" }));
  await old;
  assert.equal(c.status, newStatus);
  assert.equal(h.requests.filter(r => r.url.endsWith("old-project/cancel")).length, 1);
  assert.equal(h.requests.filter(r => r.url.endsWith("/jobs/old-project")).length, 0);
  h.requests[1].resolve(reply({ job_id: "new-project" }));
  await flush();
  await h.advance();
  h.requests.find(r => r.url.endsWith("/jobs/new-project")).resolve(reply({ status: "done", mask_track: tracked }));
  await current;
  assert.deepEqual(clone(c.sequence[0].transform.fxMaskTrack), tracked);
  assert.equal(c.status.status, "done");
});

test("deleting a mask while a poll is in flight cannot restore the deleted mask or stale status", async () => {
  const h = harness(), c = h.context;
  const run = c.trackMask(h.clip);
  h.requests[0].resolve(reply({ job_id: "delete" }));
  await flush(); await h.advance();
  const poll = h.requests.find(r => r.url.endsWith("/jobs/delete"));
  c.deleteMask(c.sequence[0]);
  assert.equal(poll.options.signal.aborted, true);
  // Ignore AbortSignal deliberately to cover a response already received by fetch.
  poll.resolve(reply({ status: "done", mask_track: tracked }));
  await run;
  assert.equal(c.status, null);
  assert.equal(c.maskTrackRun.current, null);
  assert.equal(c.sequence[0].transform.fxMaskPath, undefined);
  assert.equal(c.sequence[0].transform.fxMaskTrack, undefined);
});

test("redraw cancels immediately and an old failed request cannot overwrite the next run", async () => {
  const h = harness(), c = h.context;
  const old = c.trackMask(h.clip);
  c.openMaskEditor(h.clip, true);
  assert.equal(c.maskTrackRun.current, null);
  assert.equal(c.maskRedraw.clipId, h.clip.id);
  assert.ok(Number.isFinite(c.maskRedraw.revision));
  c.openMaskEditor(h.clip, false);
  assert.equal(c.maskRedraw, 0, 'editing must clear a previous redraw command');
  c.commitMask(h.clip, maskPath.map(p => ({ x: p.x + .1, y: p.y })), 1);
  const next = c.trackMask(c.sequence[0]);
  h.requests[0].reject(new Error("old network failure"));
  await old;
  assert.equal(c.status.status, "working");
  assert.equal(c.status.error, undefined);
  c.cancelMaskTrack();
  h.requests[1].resolve(reply({ job_id: "redrawn" }));
  await next;
  assert.equal(c.status.status, "cancelled");
  assert.ok(h.requests.some(r => r.url.endsWith("redrawn/cancel")));
});

test("reference frame, source, trim, speed, lock and point edits invalidate pending tracking", async (t) => {
  const changes = [
    ["reference frame", clip => ({ transform: { ...clip.transform, fxMaskTime: .75 } })],
    ["source", () => ({ path: "different.mp4" })],
    ["trim", () => ({ inPoint: .25 })],
    ["duration", () => ({ duration: 1 })],
    ["speed", () => ({ speed: 2 })],
    ["lock", () => ({ locked: true })],
    ["mask point", clip => ({ transform: { ...clip.transform, fxMaskPath: [...maskPath, { x: .1, y: .5 }] } })],
  ];
  for (const [name, patch] of changes) await t.test(name, async () => {
    const h = harness(), c = h.context;
    const run = c.trackMask(h.clip);
    c.updateSeqClip(h.clip.id, patch(h.clip));
    assert.equal(c.maskTrackRun.current, null);
    h.requests[0].resolve(reply({ job_id: name }));
    await run;
    assert.equal(c.sequence[0].transform.fxMaskTrack, undefined);
    assert.equal(c.status.status, "cancelled");
  });
});

test("tool selection exits drawing while a valid background track still applies to its original clip", async () => {
  const h = harness(), c = h.context;
  const run = c.trackMask(h.clip);
  c.selectTool("select");
  assert.equal(c.tool, "select");
  assert.ok(c.maskTrackRun.current);
  c.updateSeqClip(h.clip.id, { transform: { ...h.clip.transform, fxMaskShowGuide: false, maskFx: { scale: 225 } } });
  h.requests[0].resolve(reply({ job_id: "valid" }));
  await flush(); await h.advance();
  h.requests.find(r => r.url.endsWith("/jobs/valid")).resolve(reply({ status: "done", mask_track: tracked }));
  await run;
  assert.deepEqual(clone(c.sequence[0].transform.fxMaskTrack), tracked);
  assert.equal(c.sequence[0].transform.maskFx.scale, 225);
  assert.equal(c.sequence[0].transform.fxMaskShowGuide, false);
});
