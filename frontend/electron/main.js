const { app, BrowserWindow, dialog, ipcMain, protocol, shell, Menu } = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const fs = require("fs");

// scheme "media://" ให้ <video> ฝั่ง React เล่นไฟล์ในเครื่องได้
// (หน้าเว็บโหลดจาก http://localhost จึงอ้าง file:// ตรงๆ ไม่ได้)
protocol.registerSchemesAsPrivileged([
  { scheme: "media", privileges: { stream: true, bypassCSP: true, supportFetchAPI: true, corsEnabled: true } },
]);

let mainWindow;
let pythonProcess;
const settingsPath = () => path.join(app.getPath("userData"), "app-settings.json");
function readAppSettings() { try { return JSON.parse(fs.readFileSync(settingsPath(), "utf8")); } catch { return { startMaximized: true, language: "th", theme: "dark" }; } }

const isDev = !app.isPackaged;
const BACKEND_PORT = 8420; // พอร์ตคงที่สำหรับตอน dev; ตอนแพ็คจริงค่อยสุ่มพอร์ตว่างแทน

function startPythonBackend() {
  // โหมด dev: สมมติว่ารัน `uvicorn` เองแยกไว้แล้ว (ดู README) จึงยังไม่ spawn อัตโนมัติ
  // โหมด production (แพ็คแล้ว): ให้ spawn ตัว backend ที่ build ด้วย PyInstaller ไว้
  if (!isDev) {
    const backendPath = path.join(process.resourcesPath, "backend", "aiclip-backend");
    pythonProcess = spawn(backendPath, ["--port", String(BACKEND_PORT)]);
    pythonProcess.stdout.on("data", (d) => console.log(`[backend] ${d}`));
    pythonProcess.stderr.on("data", (d) => console.error(`[backend-err] ${d}`));
  }
}

function createWindow() {
  const appSettings = readAppSettings();
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: "#14161a",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    titleBarStyle: "hiddenInset",
  });
  if (appSettings.startMaximized) mainWindow.maximize();

  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

function createApplicationMenu() {
  const template = [
    {
      label: "File",
      submenu: [
        { label: "Save Project", accelerator: "CmdOrCtrl+S", click: () => mainWindow?.webContents.send("menu:save-project") },
        { label: "Settings", accelerator: "CmdOrCtrl+,", click: () => mainWindow?.webContents.send("menu:open-settings") },
        { type: "separator" },
        { label: "กลับหน้าแรก", accelerator: "CmdOrCtrl+Shift+H", click: () => mainWindow?.webContents.send("menu:go-home") },
        { type: "separator" },
        { role: "quit", label: "ออกจากโปรแกรม" },
      ],
    },
    { label: "Edit", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }] },
    { label: "View", submenu: [{ role: "reload" }, { role: "toggleDevTools" }, { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { role: "togglefullscreen" }] },
    { label: "Window", submenu: [{ role: "minimize" }, { role: "close" }] },
    { role: "help", label: "Help", submenu: [] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// media://<encoded absolute path> -> อ่านไฟล์จริงในเครื่อง
// ใช้ registerFileProtocol (ไม่ใช่ protocol.handle + net.fetch) เพราะรองรับ HTTP Range
// ซึ่ง <video> ต้องใช้ตอน seek/กรอ — ถ้าไม่มี Range วิดีโอจะเล่นได้แต่กรอไม่ได้
function registerMediaProtocol() {
  protocol.registerFileProtocol("media", (request, callback) => {
    // ตัด query string ทิ้ง (?v=n ใช้เป็น cache-buster ตอนรูปเฟรมถูกแทนที่)
    const filePath = decodeURIComponent(request.url.replace(/^media:\/\//, "").split("?")[0]);
    // ACAO จำเป็นสำหรับ Web Audio (createMediaElementSource) — ไม่มีแล้วเสียงจะเงียบสนิท
    callback({ path: filePath, headers: { "Access-Control-Allow-Origin": "*" } });
  });
}

// dialog เลือกไฟล์วิดีโอ คืน array ของ absolute path (ว่าง = ผู้ใช้กดยกเลิก)
ipcMain.handle("dialog:open-video", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "Video", extensions: ["mp4", "mov", "mkv", "avi", "webm"] }],
  });
  return result.canceled ? [] : result.filePaths;
});

// dialog เลือกรูปภาพ/ไฟล์เสียง สำหรับ Media Browser
ipcMain.handle("dialog:open-media", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "Media", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "mp3", "wav", "m4a", "aac", "ogg", "flac"] },
      { name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp"] },
      { name: "Audio", extensions: ["mp3", "wav", "m4a", "aac", "ogg", "flac"] },
    ],
  });
  return result.canceled ? [] : result.filePaths;
});

// เปิดโฟลเดอร์ใน File Explorer (ใช้โชว์ผลลัพธ์ เช่น โฟลเดอร์เฟรมที่แตกออกมา)
ipcMain.handle("shell:open-folder", (_event, dirPath) => shell.openPath(dirPath));
ipcMain.handle("app-settings:get", () => readAppSettings());
ipcMain.handle("app-settings:set", (_event, patch) => {
  const next = { ...readAppSettings(), ...(patch || {}) };
  fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2), "utf8");
  return next;
});
ipcMain.handle("export:choose-file", async (_event, defaultPath) => {
  const pick = await dialog.showSaveDialog(mainWindow, { title: "Export Video", defaultPath, filters: [{ name: "MP4 Video", extensions: ["mp4"] }] });
  return pick.canceled ? null : pick.filePath;
});
ipcMain.handle("export:finalize", (_event, source, destination) => {
  if (!source || !destination) throw new Error("Export path is missing");
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  return { ok: true, filePath: destination, bytes: fs.statSync(destination).size };
});

const recentPath = () => path.join(app.getPath("userData"), "recent-projects.json");
function readRecent() { try { return JSON.parse(fs.readFileSync(recentPath(), "utf8")); } catch { return []; } }
function addRecent(project) {
  const list = [project, ...readRecent().filter((p) => p.filePath !== project.filePath)].slice(0, 12);
  fs.writeFileSync(recentPath(), JSON.stringify(list, null, 2), "utf8");
}

ipcMain.handle("project:choose-location", async () => {
  const pick = await dialog.showOpenDialog(mainWindow, { title: "เลือกโฟลเดอร์เก็บโปรเจกต์", properties: ["openDirectory", "createDirectory"] });
  return pick.canceled ? null : pick.filePaths[0];
});
ipcMain.handle("project:create", async (_event, input) => {
  const name = typeof input === "string" ? input : input?.name;
  let parentDir = typeof input === "object" ? input?.parentDir : null;
  if (!parentDir) {
    const pick = await dialog.showOpenDialog(mainWindow, { title: "เลือกโฟลเดอร์เก็บโปรเจกต์", properties: ["openDirectory", "createDirectory"] });
    if (pick.canceled || !pick.filePaths[0]) return null;
    parentDir = pick.filePaths[0];
  }
  const safeName = String(name || "Untitled Project").trim().replace(/[<>:"/\\|?*]/g, "_") || "Untitled Project";
  const dirPath = path.join(parentDir, safeName);
  fs.mkdirSync(path.join(dirPath, "Media"), { recursive: true });
  fs.mkdirSync(path.join(dirPath, "Cache"), { recursive: true });
  fs.mkdirSync(path.join(dirPath, "Exports"), { recursive: true });
  const filePath = path.join(dirPath, `${safeName}.clipeasy.json`);
  const project = { version: 1, name: safeName, dirPath, filePath, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), data: { clips: [], media: [], sequence: [] } };
  fs.writeFileSync(filePath, JSON.stringify(project, null, 2), "utf8");
  addRecent({ name: safeName, dirPath, filePath, updatedAt: project.updatedAt });
  return project;
});

ipcMain.handle("project:open", async () => {
  const pick = await dialog.showOpenDialog(mainWindow, { title: "เปิด ClipEasy Project", properties: ["openFile"], filters: [{ name: "ClipEasy Project", extensions: ["json"] }] });
  if (pick.canceled || !pick.filePaths[0]) return null;
  const project = JSON.parse(fs.readFileSync(pick.filePaths[0], "utf8"));
  project.filePath = pick.filePaths[0];
  project.dirPath ||= path.dirname(project.filePath);
  addRecent({ name: project.name, dirPath: project.dirPath, filePath: project.filePath, updatedAt: project.updatedAt });
  return project;
});
ipcMain.handle("project:open-recent", (_event, filePath) => {
  const project = JSON.parse(fs.readFileSync(filePath, "utf8")); project.filePath = filePath; project.dirPath ||= path.dirname(filePath); return project;
});
ipcMain.handle("project:recent", () => readRecent().filter((p) => fs.existsSync(p.filePath)));
ipcMain.handle("project:save", (_event, project) => {
  if (!project?.filePath || !path.isAbsolute(project.filePath)) throw new Error("Project file path is missing or invalid");
  fs.mkdirSync(path.dirname(project.filePath), { recursive: true });
  const saved = { ...project, updatedAt: new Date().toISOString() };
  const json = JSON.stringify(saved, null, 2);
  const tempPath = `${project.filePath}.tmp`;
  fs.writeFileSync(tempPath, json, "utf8");
  fs.renameSync(tempPath, project.filePath);
  addRecent({ name: saved.name, dirPath: saved.dirPath, filePath: saved.filePath, updatedAt: saved.updatedAt });
  return { ok: true, filePath: saved.filePath, updatedAt: saved.updatedAt, bytes: Buffer.byteLength(json, "utf8") };
});
ipcMain.handle("project:copy-media", (_event, dirPath, paths) => {
  const mediaDir = path.join(dirPath, "Media"); fs.mkdirSync(mediaDir, { recursive: true });
  return paths.map((source) => {
    const ext = path.extname(source), base = path.basename(source, ext);
    let target = path.join(mediaDir, `${base}${ext}`), n = 2;
    while (fs.existsSync(target) && path.resolve(target) !== path.resolve(source)) target = path.join(mediaDir, `${base}-${n++}${ext}`);
    if (path.resolve(target) !== path.resolve(source)) fs.copyFileSync(source, target);
    return target;
  });
});

app.whenReady().then(() => {
  registerMediaProtocol();
  startPythonBackend();
  createWindow();
  createApplicationMenu();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (pythonProcess) pythonProcess.kill();
  if (process.platform !== "darwin") app.quit();
});
