/* Updater wrapper around electron-updater with safe defaults.
 *
 * - Disabled in dev (isDev === true) so local builds don't try to phone home.
 * - Forwards every electron-updater event to the renderer via the
 *   "updater:event" IPC channel so the UI can react.
 * - All public methods resolve; they never throw to the caller.
 */

import { app } from "electron";
import { createRequire } from "module";

const isDev = !app.isPackaged;
const requireCJS = createRequire(import.meta.url);

let autoUpdater = null;
let initialized = false;
let mainWindow = null;

const tryLoad = () => {
  if (autoUpdater) return autoUpdater;
  try {
    const { autoUpdater: au } = requireCJS("electron-updater");
    autoUpdater = au;
    return autoUpdater;
  } catch (e) {
    console.warn("[updater] electron-updater not available:", e.message);
    return null;
  }
};

const send = (payload) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    try { mainWindow.webContents.send("updater:event", payload); } catch {}
  }
};

const init = (win) => {
  if (initialized) return;
  initialized = true;
  mainWindow = win;
  if (isDev) {
    send({ type: "disabled", reason: "dev-build" });
    return;
  }
  const au = tryLoad();
  if (!au) {
    send({ type: "disabled", reason: "missing-module" });
    return;
  }
  au.autoDownload = true;
  au.autoInstallOnAppQuit = false;
  au.logger = null;

  au.on("checking-for-update", () => send({ type: "checking" }));
  au.on("update-available", (info) => send({ type: "available", version: info?.version, releaseDate: info?.releaseDate }));
  au.on("update-not-available", (info) => send({ type: "not-available", version: info?.version }));
  au.on("download-progress", (p) => send({ type: "downloading", percent: p?.percent ?? 0, transferred: p?.transferred, total: p?.total }));
  au.on("update-downloaded", (info) => send({ type: "ready", version: info?.version }));
  au.on("error", (err) => send({ type: "error", message: err?.message || String(err) }));
};

const checkForUpdates = async () => {
  if (isDev) return { ok: false, reason: "dev-build" };
  const au = tryLoad();
  if (!au) return { ok: false, reason: "missing-module" };
  try {
    const result = await au.checkForUpdates();
    return { ok: true, version: result?.updateInfo?.version };
  } catch (e) {
    send({ type: "error", message: e?.message || String(e) });
    return { ok: false, error: e?.message };
  }
};

const startDownload = async () => {
  if (isDev) return { ok: false, reason: "dev-build" };
  const au = tryLoad();
  if (!au) return { ok: false, reason: "missing-module" };
  try {
    await au.downloadUpdate();
    return { ok: true };
  } catch (e) {
    send({ type: "error", message: e?.message || String(e) });
    return { ok: false, error: e?.message };
  }
};

const install = () => {
  if (isDev) return;
  const au = tryLoad();
  if (!au) return;
  try { au.quitAndInstall(false, true); } catch {}
};

export { init, checkForUpdates, startDownload, install, isDev };
