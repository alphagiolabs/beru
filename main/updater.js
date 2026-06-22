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
    // Don't wipe a pending or already-downloaded update if a stale
    // update-not-available event arrives out of order (duplicate check,
    // network flip, or CDN inconsistency). Otherwise the renderer's
    // "Update now" button silently fails because the main process no
    // longer has a pendingVersion.
    if (pendingVersion || updateDownloaded) return;
    au.autoInstallOnAppQuit = false;
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
    // Enable auto-install-on-quit as a fallback: if the user closes the app
    // without clicking "Reiniciar e instalar", the NSIS installer will run on
    // the next normal quit so the update is not silently lost.
    au.autoInstallOnAppQuit = true;
    // Do NOT auto-install here. The renderer shows a "Reiniciar e instalar"
    // modal and the user must confirm the restart. Auto-installing via
    // quitAndInstall(true, true) fails silently when NSIS is configured with
    // oneClick: false (the installer cannot run in silent mode), causing the
    // app to quit, relaunch the OLD version, and re-show the same update —
    // an update loop. Let the user initiate the install explicitly instead.
    userInitiatedDownload = false;
  });
  au.on("error", (err) => {
    checkInProgress = false;
    if (downloadInProgress) downloadInProgress = false;
    userInitiatedDownload = false;
    // Don't let a stale autoInstallOnAppQuit flag cause an unexpected install
    // after a download or update error.
    au.autoInstallOnAppQuit = false;
    send({ type: "error", message: err?.message || String(err) });
  });

  // Kick a background check so that electron-updater re-emits events for any
  // update already cached from a previous session (e.g. user downloaded but
  // didn't install before quitting).  Errors are silently swallowed — this is
  // best-effort.
  checkForUpdates().catch(() => {});

  // KILL-SWITCH: Check if the current running version has been marked as bad.
  // This allows forcing a downgrade by publishing a kill-switch file that
  // blocks the current version from auto-updating to itself. The check is
  // best-effort and silently fails if the endpoint is unreachable.
  // Future: implement a remote endpoint at https://beru.app/api/kill-switch.json
  // that returns { "bad_versions": ["1.6.35"], "force_downgrade": "1.6.34" }
  checkKillSwitch().catch(() => {});
};

/**
 * Best-effort kill-switch check. Fetches a remote JSON that can mark the
 * current version as bad, forcing the user to manually downgrade.
 * Currently a stub — the endpoint is not yet deployed.
 */
const checkKillSwitch = async () => {
  if (isDev) return;
  try {
    const currentVersion = app.getVersion();
    // Future: fetch from https://beru.app/api/kill-switch.json
    // const resp = await fetch("https://beru.app/api/kill-switch.json");
    // const data = await resp.json();
    // if (data.bad_versions?.includes(currentVersion)) {
    //   send({ type: "error", message: `Version ${currentVersion} has been recalled. Please downgrade to ${data.force_downgrade || "a previous version"}.` });
    // }
  } catch {
    // Kill-switch check is best-effort — never block the app
  }
};

const checkForUpdates = async () => {
  if (isDev) return { ok: false, reason: "dev-build" };
  // Don't run a check that would wipe an already-downloaded update — it would
  // reset updateDownloaded and re-emit "available", forcing a re-download.
  if (updateDownloaded) return { ok: false, reason: "already-ready" };
  // A download in progress takes precedence over a check in progress so callers
  // always see the correct blocker reason.
  if (downloadInProgress) return { ok: false, reason: "download-in-progress" };
  // Re-use a known pending update instead of re-checking. A duplicate check can
  // emit update-not-available and clobber renderer state while the user is
  // reading the modal or starting a download.
  if (pendingVersion && !downloadInProgress) {
    send({
      type: "available",
      version: pendingVersion,
      releaseDate: lastSnapshot?.releaseDate,
      releaseNotes: lastSnapshot?.releaseNotes || "",
      releaseUrl: releaseUrlFor(pendingVersion),
    });
    return { ok: true, version: pendingVersion, reason: "pending-update" };
  }
  if (checkInProgress) return { ok: false, reason: "check-in-progress" };
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

  // Auto-retry download with exponential backoff for transient network errors.
  // Up to 2 retries: 3s, then 6s delay. Only retries if the update is still
  // pending and no new version was announced in the meantime.
  const MAX_DOWNLOAD_RETRIES = 2;
  const BASE_RETRY_DELAY_MS = 3000;
  for (let attempt = 0; attempt <= MAX_DOWNLOAD_RETRIES; attempt++) {
    try {
      await au.downloadUpdate();
      return { ok: true };
    } catch (e) {
      downloadInProgress = false;
      if (attempt < MAX_DOWNLOAD_RETRIES && pendingVersion && !updateDownloaded) {
        const delay = BASE_RETRY_DELAY_MS * (attempt + 1);
        send({
          type: "error",
          message: `Download failed (attempt ${attempt + 1}/${MAX_DOWNLOAD_RETRIES + 1}). Retrying in ${delay / 1000}s...`,
        });
        await new Promise((resolve) => setTimeout(resolve, delay));
        if (!pendingVersion || updateDownloaded) {
          userInitiatedDownload = false;
          return { ok: false, reason: "aborted" };
        }
        downloadInProgress = true;
        send({ type: "downloading", version: pendingVersion, percent: 0 });
        continue;
      }
      userInitiatedDownload = false;
      // electron-updater emits "error" for download failures; avoid duplicate IPC.
      return { ok: false, error: e?.message };
    }
  }
  userInitiatedDownload = false;
  return { ok: false, error: "download-failed" };
};

// Returns the last event payload sent to the renderer. Used by the renderer
// on startup (via getUpdaterSnapshot IPC) to hydrate the update state after a
// page reload or app restart. The snapshot is overwritten on every send(),
// so it always reflects the most recent updater event.
const getSnapshot = () => lastSnapshot;

const INSTALL_GRACE_MS = 10000;

const scheduleInstall = (au) => {
  if (isDev || !au || quittingForUpdate) return;
  quittingForUpdate = true;
  // Use silent=false because NSIS is configured with oneClick: false — the
  // installer wizard must be visible for the user to confirm the installation.
  // forceRunAfter=true so the app relaunches once the user completes the
  // wizard.
  setImmediate(() => {
    try {
      const result = au.quitAndInstall(false, true);
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
