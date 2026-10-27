const { contextBridge, ipcRenderer } = require("electron");

// ให้ React ฝั่ง renderer รู้ว่า backend อยู่ที่ port ไหน โดยไม่ต้อง hardcode ซ้ำหลายที่
contextBridge.exposeInMainWorld("aiclip", {
  backendUrl: "http://127.0.0.1:8420",
  openVideoDialog: () => ipcRenderer.invoke("dialog:open-video"),
  openMediaDialog: () => ipcRenderer.invoke("dialog:open-media"),
  openFolder: (dirPath) => ipcRenderer.invoke("shell:open-folder", dirPath),
  getAppSettings: () => ipcRenderer.invoke("app-settings:get"),
  setAppSettings: (patch) => ipcRenderer.invoke("app-settings:set", patch),
  chooseExportFile: (defaultPath) => ipcRenderer.invoke("export:choose-file", defaultPath),
  finalizeExport: (source, destination) => ipcRenderer.invoke("export:finalize", source, destination),
  chooseProjectLocation: () => ipcRenderer.invoke("project:choose-location"),
  createProject: (name, parentDir) => ipcRenderer.invoke("project:create", { name, parentDir }),
  openProject: () => ipcRenderer.invoke("project:open"),
  openRecentProject: (filePath) => ipcRenderer.invoke("project:open-recent", filePath),
  recentProjects: () => ipcRenderer.invoke("project:recent"),
  saveProject: (project) => ipcRenderer.invoke("project:save", project),
  copyProjectMedia: (dirPath, paths) => ipcRenderer.invoke("project:copy-media", dirPath, paths),
  onGoHome: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("menu:go-home", handler);
    return () => ipcRenderer.removeListener("menu:go-home", handler);
  },
  onSaveProject: (callback) => { const handler = () => callback(); ipcRenderer.on("menu:save-project", handler); return () => ipcRenderer.removeListener("menu:save-project", handler); },
  onOpenSettings: (callback) => { const handler = () => callback(); ipcRenderer.on("menu:open-settings", handler); return () => ipcRenderer.removeListener("menu:open-settings", handler); },
});
