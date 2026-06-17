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
let userInitiatedDownload = false;

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
    const version = info?.version || null;
    // If this exact version is already downloaded, keep the "ready" state
    // instead of flipping back to "available" — otherwise a background
    // re-check would wipe updateDownloaded and force a re-download loop.
    if (updateDownloaded && pendingVersion && version === pendingVersion) {
      send({ type: "ready", version: pendingVersion });
      return;
    }
    // New version announced — any prior user-initiation flag was for the
    // previous version and must not survive the transition.
    userInitiatedDownload = false;
    updateDownloaded = false;
    pendingVersion = version;
    send({
      type: "available",
      version,
      releaseDate: info?.releaseDate,
      releaseNotes: info?.releaseNotes || "",
      releaseUrl: releaseUrlFor(version),
    });
  });
  au.on("update-not-available", (info) => {
    pendingVersion = null;
    updateDownloaded = false;
    userInitiatedDownload = false;
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
    send({ type: "ready", version: info?.version || pendingVersion });
    // Honor the downloading-modal copy: "Beru se reiniciará e instalará la
    // actualización automáticamente al terminar." When the user explicitly
    // clicked "Actualizar ahora" in this session, trigger quitAndInstall so
    // the app actually restarts. For cached updates from a previous session
    // (no userInitiatedDownload flag) the renderer keeps showing the "ready"
    // modal so the user can confirm the restart themselves.
    if (userInitiatedDownload) {
      userInitiatedDownload = false;
      scheduleInstall(au);
    }
  });
  au.on("error", (err) => {
    checkInProgress = false;
    if (downloadInProgress) downloadInProgress = false;
    userInitiatedDownload = false;
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
  // Don't run a check that would wipe an already-downloaded update — it would
  // reset updateDownloaded and re-emit "available", forcing a re-download.
  if (updateDownloaded) return { ok: false, reason: "already-ready" };
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

  // Mark this as a user-initiated download so the "update-downloaded" handler
  // can auto-install and honor the modal copy. Cleared on every error/cancel
  // path below.
  userInitiatedDownload = true;

  if (!pendingVersion) {
    try {
      const result = await au.checkForUpdates();
      pendingVersion = result?.updateInfo?.version || null;
      if (!pendingVersion) {
        userInitiatedDownload = false;
        return { ok: false, error: "no-update-available" };
      }
    } catch (e) {
      userInitiatedDownload = false;
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
    userInitiatedDownload = false;
    // electron-updater emits "error" for download failures; avoid duplicate IPC.
    return { ok: false, error: e?.message };
  }
};

const getSnapshot = () => lastSnapshot;

const INSTALL_GRACE_MS = 10000;

const scheduleInstall = (au) => {
  if (isDev || !au || quittingForUpdate) return;
  quittingForUpdate = true;
  // Silent + force-run is the standard for NSIS auto-updates. A non-silent
  // assisted update (oneClick: false) can surface a wizard or fail to apply
  // silently; the app then quits, --force-run relaunches the OLD version, and
  // the same update reappears on the next launch → update loop.
  setImmediate(() => {
    try {
      const result = au.quitAndInstall(true, true);
      // electron-updater's install is fire-and-forget for NSIS, but newer
      // builds may return a promise — handle both so a rejection never leaves
      // us stuck in the "install-in-progress" state.
      if (result && typeof result.catch === "function") {
        result.catch((e) => {
          quittingForUpdate = false;
          send({ type: "error", message: e?.message || String(e) });
        });
      }
    } catch (e) {
      quittingForUpdate = false;
      send({ type: "error", message: e?.message || String(e) });
    }
  });
  // Safety net: NSIS install is fire-and-forget, so quitAndInstall() does NOT
  // reject when the installer spawn fails — it just quits. If we are still
  // alive after the grace period, the quit was blocked or the spawn failed;
  // reset quittingForUpdate so the user can retry the install instead of being
  // locked out with "install-in-progress".
  setTimeout(() => {
    if (quittingForUpdate) {
      quittingForUpdate = false;
      send({
        type: "error",
        message: "No se pudo reiniciar para instalar la actualización. Inténtalo de nuevo.",
      });
    }
  }, INSTALL_GRACE_MS);
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
