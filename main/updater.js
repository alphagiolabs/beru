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
let lastSnapshot = null;
let pendingVersion = null;
let checkInProgress = false;
let downloadInProgress = false;
let quittingForUpdate = false;
let updateDownloaded = false;

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
  lastSnapshot = payload;
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.webContents.send("updater:event", payload);
    } catch {}
  }
};

const releaseUrlFor = (version) => {
  if (!version) return null;
  return `https://github.com/alphagiolabs/beru/releases/tag/v${String(version).replace(/^v/i, "")}`;
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
  au.autoDownload = false;
  au.autoInstallOnAppQuit = false;
  au.logger = null;

  au.on("checking-for-update", () => send({ type: "checking" }));
  au.on("update-available", (info) => {
    updateDownloaded = false;
    pendingVersion = info?.version || null;
    send({
      type: "available",
      version: info?.version,
      releaseDate: info?.releaseDate,
      releaseNotes: info?.releaseNotes || "",
      releaseUrl: releaseUrlFor(info?.version),
    });
  });
  au.on("update-not-available", (info) => {
    pendingVersion = null;
    updateDownloaded = false;
    send({ type: "not-available", version: info?.version });
  });
  au.on("download-progress", (p) =>
    send({
      type: "downloading",
      version: pendingVersion,
      percent: p?.percent ?? 0,
      transferred: p?.transferred,
      total: p?.total,
    }),
  );
  au.on("update-downloaded", (info) => {
    downloadInProgress = false;
    updateDownloaded = true;
    pendingVersion = info?.version || pendingVersion;
    // Intentionally do NOT auto-install. Surface the "ready" snapshot to the
    // renderer so the user can confirm the install via the modal. The renderer
    // is the single source of truth for whether the user wants to restart now.
    send({ type: "ready", version: info?.version || pendingVersion });
  });
  au.on("error", (err) => {
    checkInProgress = false;
    if (downloadInProgress) downloadInProgress = false;
    send({ type: "error", message: err?.message || String(err) });
  });

  // Kick a background check so that electron-updater re-emits events for any
  // update already cached from a previous session (e.g. user downloaded but
  // didn't install before quitting).  Errors are silently swallowed — this is
  // best-effort.
  checkForUpdates().catch(() => {});
};

const checkForUpdates = async () => {
  if (isDev) return { ok: false, reason: "dev-build" };
  if (checkInProgress) return { ok: false, reason: "check-in-progress" };
  if (downloadInProgress) return { ok: false, reason: "download-in-progress" };
  const au = tryLoad();
  if (!au) return { ok: false, reason: "missing-module" };
  checkInProgress = true;
  try {
    const result = await au.checkForUpdates();
    return { ok: true, version: result?.updateInfo?.version };
  } catch (e) {
    send({ type: "error", message: e?.message || String(e) });
    return { ok: false, error: e?.message };
  } finally {
    checkInProgress = false;
  }
};

const startDownload = async () => {
  if (isDev) return { ok: false, reason: "dev-build" };
  if (downloadInProgress) return { ok: true, reason: "already-downloading" };
  const au = tryLoad();
  if (!au) return { ok: false, reason: "missing-module" };

  if (!pendingVersion) {
    try {
      const result = await au.checkForUpdates();
      pendingVersion = result?.updateInfo?.version || null;
      if (!pendingVersion) {
        return { ok: false, error: "no-update-available" };
      }
    } catch (e) {
      send({ type: "error", message: e?.message || String(e) });
      return { ok: false, error: e?.message };
    }
  }

  if (updateDownloaded) {
    // Already downloaded this version: surface the "ready" snapshot and let
    // the renderer prompt the user. Do NOT trigger quitAndInstall from here.
    send({ type: "ready", version: pendingVersion });
    return { ok: true, reason: "already-downloaded" };
  }

  downloadInProgress = true;
  send({
    type: "downloading",
    version: pendingVersion,
    percent: 0,
    transferred: 0,
    total: 0,
  });
  try {
    await au.downloadUpdate();
    return { ok: true };
  } catch (e) {
    downloadInProgress = false;
    // electron-updater emits "error" for download failures; avoid duplicate IPC.
    return { ok: false, error: e?.message };
  }
};

const getSnapshot = () => lastSnapshot;

const scheduleInstall = (au) => {
  if (isDev || !au || quittingForUpdate) return;
  quittingForUpdate = true;
  setImmediate(() => {
    try {
      au.quitAndInstall(false, true);
    } catch (e) {
      quittingForUpdate = false;
      send({ type: "error", message: e?.message || String(e) });
    }
  });
};

const install = () => {
  if (isDev) return { ok: false, reason: "dev-build" };
  if (quittingForUpdate) return { ok: false, reason: "install-in-progress" };
  if (!updateDownloaded) return { ok: false, error: "update-not-downloaded" };
  const au = tryLoad();
  if (!au) return { ok: false, reason: "missing-module" };
  scheduleInstall(au);
  return { ok: true };
};

const isQuittingForUpdate = () => quittingForUpdate;

export { init, checkForUpdates, startDownload, install, getSnapshot, isQuittingForUpdate, isDev };
