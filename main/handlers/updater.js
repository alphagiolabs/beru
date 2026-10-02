import { ipcMain } from "electron";
import * as updater from "../updater.js";
import { IPC_INVOKE } from "../../shared/ipc-channels.js";

export function registerUpdaterHandlers() {
  ipcMain.handle(IPC_INVOKE.checkForUpdates, () => updater.checkForUpdates());
  ipcMain.handle(IPC_INVOKE.downloadUpdate, (_event, opts) => updater.startDownload(opts));
  ipcMain.handle(IPC_INVOKE.installUpdate, () => updater.install());
  ipcMain.handle(IPC_INVOKE.getUpdaterSnapshot, () => updater.getSnapshot());
}
