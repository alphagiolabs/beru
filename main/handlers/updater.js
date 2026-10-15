import { ipcMain } from "electron";
import * as updater from "../updater.js";
import { IPC_INVOKE } from "../../shared/ipc-channels.js";
import { isTrustedSender } from "../utils/ipc.js";

export function registerUpdaterHandlers() {
  ipcMain.handle(IPC_INVOKE.checkForUpdates, (event) => {
    if (!isTrustedSender(event)) throw new Error("untrusted sender");
    return updater.checkForUpdates();
  });
  ipcMain.handle(IPC_INVOKE.downloadUpdate, (event, opts) => {
    if (!isTrustedSender(event)) throw new Error("untrusted sender");
    return updater.startDownload(opts);
  });
  ipcMain.handle(IPC_INVOKE.installUpdate, (event) => {
    if (!isTrustedSender(event)) throw new Error("untrusted sender");
    return updater.install();
  });
  ipcMain.handle(IPC_INVOKE.getUpdaterSnapshot, (event) => {
    if (!isTrustedSender(event)) throw new Error("untrusted sender");
    return updater.getSnapshot();
  });
}
