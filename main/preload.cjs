const { contextBridge, ipcRenderer, webUtils } = require("electron");

const invoke =
  (channel) =>
  (...args) =>
    ipcRenderer.invoke(channel, ...args);

function subscribe(channel, callback) {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld("api", {
  openVideos: invoke("dialog:openVideos"),
  openExcel: invoke("dialog:openExcel"),
  selectOutputDir: invoke("dialog:selectOutputDir"),
  restoreSessionPaths: invoke("session:restorePaths"),
  getVideoInfo: invoke("fs:getVideoInfo"),
  getVideoInfoBatch: invoke("fs:getVideoInfoBatch"),
  releaseVideoPaths: invoke("video:releasePaths"),
  readExcel: invoke("fs:readExcel"),
  saveExcelDialog: invoke("dialog:saveExcel"),
  writeExcel: invoke("fs:writeExcel"),
  startProcessing: invoke("process:start"),
  cancelProcessing: invoke("process:cancel"),
  openPath: invoke("shell:openPath"),
  showItemInFolder: invoke("shell:showItemInFolder"),
  saveProject: invoke("project:save"),
  loadProject: invoke("project:load"),
  loadProjectFromPath: invoke("project:loadFromPath"),
  listPresets: invoke("presets:list"),
  savePreset: invoke("presets:save"),
  deletePreset: invoke("presets:delete"),
  loadSettings: invoke("settings:load"),
  saveSettings: invoke("settings:save"),
  setWindowTheme: invoke("window:setTheme"),
  getBatchCapacity: invoke("system:getBatchCapacity"),
  listRecent: invoke("recent:list"),
  addRecent: invoke("recent:add"),
  removeRecent: invoke("recent:remove"),
  checkForUpdates: invoke("updater:check"),
  downloadUpdate: invoke("updater:download"),
  installUpdate: invoke("updater:install"),
  getUpdaterSnapshot: invoke("updater:getSnapshot"),
  fetchPetManifest: invoke("petdex:fetchManifest"),
  listInstalledPets: invoke("petdex:listInstalled"),
  installPet: invoke("petdex:install"),
  getPetSpritesheet: invoke("petdex:getSpritesheet"),
  getBundledSpritesheet: invoke("petdex:getBundledSpritesheet"),
  openPetOverlay: invoke("petOverlay:open"),
  closePetOverlay: invoke("petOverlay:close"),
  togglePetOverlay: invoke("petOverlay:toggle"),
  syncPetOverlayState: invoke("petOverlay:sync"),
  getPetOverlayState: invoke("petOverlay:getState"),
  popInPetOverlay: invoke("petOverlay:popIn"),
  dragPetOverlayBy: invoke("petOverlay:dragBy"),
  onPetOverlayState: (cb) => subscribe("petOverlay:state", cb),
  onPetOverlayEvent: (cb) => subscribe("petOverlay:event", cb),
  onUpdaterEvent: (cb) => subscribe("updater:event", cb),
  readImage: invoke("image:read"),
  pickImage: invoke("image:pick"),
  resolveDroppedPaths: invoke("fs:resolveDroppedPaths"),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  getThumbnail: invoke("video:thumbnail"),
  getThumbnailBatch: invoke("video:thumbnailBatch"),
  getFilmstrip: invoke("video:filmstrip"),
  cancelFilmstrip: invoke("video:cancelFilmstrip"),
  onFilmstripProgress: (callback) => subscribe("video:filmstripProgress", callback),
  renderPreviewFrame: invoke("video:renderPreviewFrame"),
  renderSourceFrame: invoke("video:renderSourceFrame"),

  onProgress: (cb) => subscribe("process:progress", cb),
  onJobProgress: (cb) => subscribe("process:jobProgress", cb),
  onComplete: (cb) => subscribe("process:complete", cb),
  onSummary: (cb) => subscribe("process:summary", cb),
  onJobError: (cb) => subscribe("process:jobError", cb),
  onJobCancelled: (cb) => subscribe("process:jobCancelled", cb),
  onFinished: (cb) => subscribe("process:finished", cb),
  onRunStarted: (cb) => subscribe("process:runStarted", cb),
  onError: (cb) => subscribe("process:error", cb),
});
