const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  openVideos: () => ipcRenderer.invoke("dialog:openVideos"),
  openExcel: () => ipcRenderer.invoke("dialog:openExcel"),
  selectOutputDir: () => ipcRenderer.invoke("dialog:selectOutputDir"),
  getVideoInfo: (path) => ipcRenderer.invoke("fs:getVideoInfo", path),
  getVideoInfoBatch: (paths) => ipcRenderer.invoke("fs:getVideoInfoBatch", paths),
  readExcel: (path) => ipcRenderer.invoke("fs:readExcel", path),
  startProcessing: (jobs) => ipcRenderer.invoke("process:start", jobs),
  cancelProcessing: () => ipcRenderer.invoke("process:cancel"),
  exportProcessingLogs: (text) => ipcRenderer.invoke("process:exportLogs", text),
  openPath: (path) => ipcRenderer.invoke("shell:openPath", path),
  showItemInFolder: (path) => ipcRenderer.invoke("shell:showItemInFolder", path),
  saveProject: (payload) => ipcRenderer.invoke("project:save", payload),
  loadProject: () => ipcRenderer.invoke("project:load"),
  loadProjectFromPath: (path) => ipcRenderer.invoke("project:loadFromPath", path),
  listPresets: () => ipcRenderer.invoke("presets:list"),
  savePreset: (name, jsonStr) => ipcRenderer.invoke("presets:save", name, jsonStr),
  loadSettings: () => ipcRenderer.invoke("settings:load"),
  saveSettings: (partial) => ipcRenderer.invoke("settings:save", partial),
  setWindowTheme: (theme) => ipcRenderer.invoke("window:setTheme", theme),
  setTitleBarChrome: (chrome) => ipcRenderer.invoke("window:setTitleBarChrome", chrome),
  getBatchCapacity: (opts) => ipcRenderer.invoke("system:getBatchCapacity", opts),
  listRecent: () => ipcRenderer.invoke("recent:list"),
  addRecent: (entry) => ipcRenderer.invoke("recent:add", entry),
  removeRecent: (path) => ipcRenderer.invoke("recent:remove", path),
  listExecutionHistory: () => ipcRenderer.invoke("executionHistory:list"),
  saveExecutionHistory: (history) => ipcRenderer.invoke("executionHistory:save", history),
  clearExecutionHistory: () => ipcRenderer.invoke("executionHistory:clear"),
  checkForUpdates: () => ipcRenderer.invoke("updater:check"),
  downloadUpdate: () => ipcRenderer.invoke("updater:download"),
  installUpdate: () => ipcRenderer.invoke("updater:install"),
  getUpdaterSnapshot: () => ipcRenderer.invoke("updater:getSnapshot"),
  openExternal: (url) => ipcRenderer.invoke("shell:openExternal", url),
  onUpdaterEvent: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on("updater:event", handler);
    return () => ipcRenderer.removeListener("updater:event", handler);
  },
  readImage: (path) => ipcRenderer.invoke("image:read", path),
  pickImage: () => ipcRenderer.invoke("image:pick"),
  resolveDroppedPaths: (paths) => ipcRenderer.invoke("fs:resolveDroppedPaths", paths),
  getThumbnail: (path) => ipcRenderer.invoke("video:thumbnail", path),
  getThumbnailBatch: (paths) => ipcRenderer.invoke("video:thumbnailBatch", paths),
  renderPreviewFrame: (payload) => ipcRenderer.invoke("video:renderPreviewFrame", payload),

  onProgress: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on("process:progress", handler);
    return () => ipcRenderer.removeListener("process:progress", handler);
  },
  onJobProgress: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on("process:jobProgress", handler);
    return () => ipcRenderer.removeListener("process:jobProgress", handler);
  },
  onComplete: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on("process:complete", handler);
    return () => ipcRenderer.removeListener("process:complete", handler);
  },
  onSummary: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on("process:summary", handler);
    return () => ipcRenderer.removeListener("process:summary", handler);
  },
  onJobError: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on("process:jobError", handler);
    return () => ipcRenderer.removeListener("process:jobError", handler);
  },
  onFinished: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on("process:finished", handler);
    return () => ipcRenderer.removeListener("process:finished", handler);
  },
  onError: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on("process:error", handler);
    return () => ipcRenderer.removeListener("process:error", handler);
  },
  onLog: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on("process:log", handler);
    return () => ipcRenderer.removeListener("process:log", handler);
  },
});
