const { test, before } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");

const mainPath = path.resolve(__dirname, "../electron/main.js");
const mainSource = fs.readFileSync(mainPath, "utf8");
const mainRequire = createRequire(mainPath);
let mask;
before(async () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/components/maskFx.js"), "utf8");
  mask = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
});

// Execute the real main process module; only Electron's GUI/startup boundary is
// mocked. Project creation, serialization, atomic saves and disk reads stay real.
function loadProjectHandlers(userData) {
  const handlers = new Map();
  const unexpected = () => { throw new Error("The persistence test must not open windows or dialogs"); };
  const electron = {
    app: {
      isPackaged: false,
      getPath(name) { assert.equal(name, "userData"); return userData; },
      whenReady: () => ({ then() {} }),
      on() {},
      quit: unexpected,
    },
    BrowserWindow: unexpected,
    dialog: { showOpenDialog: unexpected, showSaveDialog: unexpected },
    ipcMain: { handle(name, handler) { handlers.set(name, handler); } },
    protocol: { registerSchemesAsPrivileged() {}, registerFileProtocol: unexpected },
    shell: { openPath: unexpected },
    Menu: { buildFromTemplate: unexpected, setApplicationMenu: unexpected },
  };
  const context = vm.createContext({
    require: (name) => name === "electron" ? electron : mainRequire(name),
    __dirname: path.dirname(mainPath),
    __filename: mainPath,
    process: { platform: process.platform },
    Buffer,
    console,
  });
  new vm.Script(mainSource, { filename: mainPath }).runInContext(context);
  return async (name, ...args) => {
    assert.ok(handlers.has(name), `${name} must be registered by electron/main.js`);
    // IPC uses a structured clone in production. JSON data here also removes VM
    // prototypes so assertions compare values rather than JavaScript realms.
    const value = await handlers.get(name)({}, ...structuredClone(args));
    return value === undefined ? value : JSON.parse(JSON.stringify(value));
  };
}

async function fixture(t) {
  const root = fs.mkdtempSync(path.join(__dirname, "tmp-mask-persistence-"));
  const userData = path.join(root, "user-data");
  fs.mkdirSync(userData);
  t.after(() => {
    const target = path.resolve(root);
    assert.equal(path.dirname(target), path.resolve(__dirname));
    assert.ok(path.basename(target).startsWith("tmp-mask-persistence-"));
    fs.rmSync(target, { recursive: true, force: true });
  });
  const invoke = loadProjectHandlers(userData);
  const project = await invoke("project:create", { name: "Mask หัวโต", parentDir: root });
  const transform = {
    x: 12, y: -4, scale: 95, rotation: 7,
    fxMaskPath: [{ x: .1875, y: .125 }, { x: .421875, y: .15625 }, { x: .46875, y: .5625 }, { x: .15625, y: .625 }],
    fxMaskRect: { x: .15625, y: .125, w: .3125, h: .5 },
    fxMaskTime: 3.375,
    fxMaskTrack: [
      { time: 2.5, matrix: [.98, -.03, .03, .98, -.015, .01], confidence: .91 },
      { time: 3.375, matrix: [1, 0, 0, 1, 0, 0], confidence: 1 },
      { time: 5.5, matrix: [1.04, .02, -.02, 1.04, .03, -.02], confidence: .89 },
    ],
    fxMaskShowGuide: false,
    maskFx: { enabled: true, scale: 175, center: { x: .3125, y: .375 }, feather: .0125,
      start: .5, enter: .75, hold: 1.5, exit: .625, bounce: .35, trackingEnabled: true },
  };
  project.data = {
    clips: [{ id: "source-1", name: "คนเต้น.mp4", path: path.join(project.dirPath, "Media", "คนเต้น.mp4") }],
    media: [],
    sequence: [{ id: "video-1", kind: "video", track: "V1", start: 8, inPoint: 2.5, duration: 4,
      path: path.join(project.dirPath, "Media", "คนเต้น.mp4"), transform }],
  };
  return { project, transform, invoke, restart: () => loadProjectHandlers(userData), userData };
}

test("actual project save/open IPC preserves mask geometry, reference frame, tracking and animation", async (t) => {
  const { project, transform, invoke, restart, userData } = await fixture(t);
  assert.ok(path.isAbsolute(project.filePath));
  assert.equal(project.filePath, path.join(project.dirPath, `${project.name}.clipeasy.json`));
  for (const dir of ["Media", "Cache", "Exports"]) assert.ok(fs.statSync(path.join(project.dirPath, dir)).isDirectory());

  const result = await invoke("project:save", project);
  assert.equal(result.ok, true);
  assert.equal(result.bytes, fs.statSync(project.filePath).size);
  assert.equal(fs.existsSync(`${project.filePath}.tmp`), false, "atomic save must leave only the committed file");
  const raw = JSON.parse(fs.readFileSync(project.filePath, "utf8"));
  assert.deepEqual(raw.data.sequence[0].transform, transform);
  assert.equal(raw.updatedAt, result.updatedAt);

  // A fresh module instance cannot satisfy this check with in-memory state.
  const reopened = await restart()("project:open-recent", project.filePath);
  assert.deepEqual(reopened.data, project.data);
  const restored = reopened.data.sequence[0].transform;
  assert.ok(restored.fxMaskPath.every((p) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1));
  for (const [sourceTime, localTime] of [[2.5, 0], [3.375, .875], [4.5, 2], [6.5, 4]]) {
    assert.deepEqual(mask.maskStateAt(restored, sourceTime, localTime), mask.maskStateAt(transform, sourceTime, localTime));
  }
  const recent = JSON.parse(fs.readFileSync(path.join(userData, "recent-projects.json"), "utf8"));
  assert.equal(recent.length, 1);
  assert.equal(recent[0].filePath, project.filePath);
});

test("second save persists edited mask and disabled/hidden settings instead of reviving previous values", async (t) => {
  const { project, invoke, restart } = await fixture(t);
  await invoke("project:save", project);
  const edited = await restart()("project:open-recent", project.filePath);
  const transform = edited.data.sequence[0].transform;
  transform.fxMaskPath[0] = { x: .125, y: .0625 };
  transform.fxMaskRect = mask.maskBounds(transform.fxMaskPath);
  transform.fxMaskTime = 4.125;
  transform.fxMaskTrack = [];
  transform.fxMaskShowGuide = false;
  transform.maskFx = { ...transform.maskFx, enabled: false, trackingEnabled: false, center: null,
    start: 0, enter: 0, hold: 0, exit: 0, bounce: 0, feather: 0 };
  await invoke("project:save", edited);
  const reopened = await restart()("project:open-recent", project.filePath);
  assert.deepEqual(reopened.data.sequence[0].transform, transform);
  assert.equal(mask.maskStateAt(reopened.data.sequence[0].transform, 4.125, 1).scale, 1);
});

test("deleting a mask in a later save removes its data on disk and after reopening", async (t) => {
  const { project, invoke, restart } = await fixture(t);
  await invoke("project:save", project);
  const edited = await restart()("project:open-recent", project.filePath);
  const transform = edited.data.sequence[0].transform;
  const keys = ["fxMaskPath", "fxMaskRect", "fxMaskTime", "fxMaskTrack", "fxMaskShowGuide", "maskFx"];
  for (const key of keys) delete transform[key];
  await invoke("project:save", edited);
  const raw = JSON.parse(fs.readFileSync(project.filePath, "utf8"));
  const reopened = await restart()("project:open-recent", project.filePath);
  for (const saved of [raw, reopened]) {
    const result = saved.data.sequence[0].transform;
    for (const key of keys) assert.equal(Object.hasOwn(result, key), false, `${key} must stay deleted`);
    assert.deepEqual(result, { x: 12, y: -4, scale: 95, rotation: 7 });
    assert.equal(mask.hasMask(result), false);
    assert.equal(mask.maskStateAt(result, 3.375, 2).scale, 1);
  }
});
