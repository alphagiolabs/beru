import { createRequire } from "module";
import { getMainWindow, isDev, setAppIsQuitting } from "./shared-state.js";
import { cancelActiveProcessing } from "./handlers/process.js";
const requireCJS = createRequire(import.meta.url);

let autoUpdater = null;
let initialized = false;
let lastSnapshot = null;
let pendingVersion = null;
let checkInProgress = false;
let downloadInProgress = false;
// Stays true across retry backoff. downloadInProgress is false between attempts;
// electron-updater downloadUpdate is not concurrency-safe.
let downloadBusy = false;
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
  // Window can be recreated after a renderer crash; a captured ref would drop events.
  const win = getMainWindow();
  if (win && !win.isDestroyed()) {
    try {
      win.webContents.send("updater:event", payload);
    } catch {}
  }
};

const releaseUrlFor = (version) => {
  if (!version) return null;
  return `https://github.com/alphagiolabs/beru/releases/tag/v${String(version).replace(/^v/i, "")}`;
};

const init = (_win) => {
  if (initialized) return;
  initialized = true;
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
  // logger=null TypeErrors inside NsisUpdater/verifySignature and hides the real error.
  au.logger = {
    info: (...args) => console.log("[updater]", ...args),
    warn: (...args) => console.warn("[updater]", ...args),
    error: (...args) => console.error("[updater]", ...args),
    debug: (...args) => console.debug("[updater]", ...args),
  };
  // Builds ≤1.6.40 baked publisherName into app-update.yml, so unsigned NSIS
  // installers fail Authenticode. Override at runtime for already-installed apps.
  au.verifyUpdateCodeSignature = async () => null;

  au.on("checking-for-update", () => send({ type: "checking" }));
  au.on("update-available", (info) => {
    const version = info?.version || null;
    if (updateDownloaded && pendingVersion && version === pendingVersion) {
      send({ type: "ready", version: pendingVersion });
      return;
    }
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
    au.autoInstallOnAppQuit = true;
    // oneClick: false cannot silent-install. quitAndInstall(true, true) relaunches
    // the old build. The renderer modal must start the install.
  });
  au.on("error", (err) => {
    checkInProgress = false;
    if (downloadInProgress) downloadInProgress = false;
    au.autoInstallOnAppQuit = false;
    send({ type: "error", message: err?.message || String(err) });
  });

  checkForUpdates().catch(() => {});
};

const checkForUpdates = async () => {
  if (isDev) return { ok: false, reason: "dev-build" };
  if (updateDownloaded) return { ok: false, reason: "already-ready" };
  if (downloadInProgress) return { ok: false, reason: "download-in-progress" };
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

const resolvePendingVersion = (hint) => {
  if (pendingVersion) return pendingVersion;
  const fromHint = hint && String(hint).replace(/^v/i, "");
  if (fromHint) return fromHint;
  if (lastSnapshot?.type === "available" && lastSnapshot?.version) {
    return lastSnapshot.version;
  }
  return null;
};

const startDownload = async (opts = {}) => {
  if (isDev) return { ok: false, reason: "dev-build" };
  if (downloadBusy) return { ok: true, reason: "already-downloading" };
  const au = tryLoad();
  if (!au) return { ok: false, reason: "missing-module" };

  const versionHint = opts?.version ?? null;
  if (!pendingVersion) {
    pendingVersion = resolvePendingVersion(versionHint);
  }

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
    send({ type: "ready", version: pendingVersion });
    return { ok: true, reason: "already-downloaded" };
  }

  downloadInProgress = true;
  downloadBusy = true;
  send({
    type: "downloading",
    version: pendingVersion,
    percent: 0,
    transferred: 0,
    total: 0,
  });

  const MAX_DOWNLOAD_RETRIES = 2;
  const BASE_RETRY_DELAY_MS = 3000;
  for (let attempt = 0; attempt <= MAX_DOWNLOAD_RETRIES; attempt++) {
    try {
      await au.downloadUpdate();
      downloadBusy = false;
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
          downloadBusy = false;
          return { ok: false, reason: "aborted" };
        }
        downloadInProgress = true;
        send({ type: "downloading", version: pendingVersion, percent: 0 });
        continue;
      }
      downloadBusy = false;
      // electron-updater emits "error" for download failures; avoid duplicate IPC.
      return { ok: false, error: e?.message };
    }
  }
};

const getSnapshot = () => lastSnapshot;

const INSTALL_GRACE_MS = 10000;

const scheduleInstall = (au) => {
  if (isDev || !au || quittingForUpdate) return;
  quittingForUpdate = true;
  setAppIsQuitting(true);
  // silent=false: NSIS oneClick:false must show the wizard. forceRunAfter relaunches after it.
  setImmediate(() => {
    Promise.resolve(cancelActiveProcessing())
      .catch((e) => {
        console.error("[updater] cancel before install failed:", e?.message || e);
      })
      .finally(() => {
        try {
          const result = au.quitAndInstall(false, true);
          if (result && typeof result.catch === "function") {
            result.catch((e) => {
              quittingForUpdate = false;
              setAppIsQuitting(false);
              send({ type: "error", message: e?.message || String(e) });
            });
          }
        } catch (e) {
          quittingForUpdate = false;
          setAppIsQuitting(false);
          send({ type: "error", message: e?.message || String(e) });
        }
      });
  });
  // NSIS quitAndInstall does not reject on spawn failure. If we are still alive
  // after the grace period, unlock so the user can retry.
  setTimeout(() => {
    if (quittingForUpdate) {
      quittingForUpdate = false;
      setAppIsQuitting(false);
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

export { init, checkForUpdates, startDownload, install, getSnapshot, isQuittingForUpdate };
