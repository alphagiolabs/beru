import { createRequire } from "module";
import { getMainWindow, isDev, setAppIsQuitting } from "./shared-state.js";
import { cancelRun } from "./processing-run.js";
import { IPC_EVENTS } from "../shared/ipc-channels.js";
const requireCJS = createRequire(import.meta.url);

let autoUpdater = null;
let initialized = false;
let lastSnapshot = null;
let pendingVersion = null;
let releaseInfo = null;
let installTimer = null;
let installAttempt = 0;

let status = "idle";

const isDownloadBusy = () => status === "downloading" || status === "retrying";
const INTEGRITY_ERRORS = new Set(["ERR_UPDATER_INVALID_SIGNATURE", "ERR_CHECKSUM_MISMATCH"]);
const errorMessage = (error) =>
  INTEGRITY_ERRORS.has(error?.code) ? error.code : error?.message || String(error);

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
  lastSnapshot = { ...releaseInfo, ...payload };
  // Window can be recreated after a renderer crash; a captured ref would drop events.
  const win = getMainWindow();
  if (win && !win.isDestroyed()) {
    try {
      win.webContents.send(IPC_EVENTS.onUpdaterEvent, lastSnapshot);
    } catch {}
  }
};

const releaseUrlFor = (version) => {
  if (!version) return null;
  return `https://github.com/alphagiolabs/beru/releases/tag/v${String(version).replace(/^v/i, "")}`;
};

const init = () => {
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
  au.disableWebInstaller = true;
  // NsisUpdater.verifySignature needs a logger to report the original error.
  au.logger = {
    info: (...args) => console.log("[updater]", ...args),
    warn: (...args) => console.warn("[updater]", ...args),
    error: (...args) => console.error("[updater]", ...args),
    debug: (...args) => console.debug("[updater]", ...args),
  };
  au.on("checking-for-update", () => send({ type: "checking" }));
  au.on("update-available", (info) => {
    const version = info?.version || null;
    if (isDownloadBusy() || status === "installing" || status === "ready") return;
    status = "available";
    pendingVersion = version;
    releaseInfo = {
      version,
      releaseDate: info?.releaseDate,
      releaseNotes: info?.releaseNotes || "",
      releaseUrl: releaseUrlFor(version),
    };
    send({ type: "available" });
  });
  au.on("update-not-available", (info) => {
    if (pendingVersion || status === "ready") return;
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
    pendingVersion = info?.version || pendingVersion;
    if (status !== "installing") status = "ready";
    send({ type: "ready", version: info?.version || pendingVersion });
  });
  au.on("error", (err) => {
    if (status === "installing") {
      abortInstall(err);
      return;
    }
    if (isDownloadBusy()) return;
    if (status === "checking") status = pendingVersion ? "available" : "idle";
    send({ type: "error", message: err?.message || String(err) });
  });

  checkForUpdates().catch(() => {});
};

const checkForUpdates = async () => {
  if (isDev) return { ok: false, reason: "dev-build" };
  if (status === "installing") return { ok: false, reason: "install-in-progress" };
  if (status === "ready") return { ok: false, reason: "already-ready" };
  if (isDownloadBusy()) return { ok: false, reason: "download-in-progress" };
  if (pendingVersion) {
    send({
      type: "available",
      version: pendingVersion,
      releaseUrl: releaseUrlFor(pendingVersion),
    });
    return { ok: true, version: pendingVersion, reason: "pending-update" };
  }
  if (status === "checking") return { ok: false, reason: "check-in-progress" };
  const au = tryLoad();
  if (!au) return { ok: false, reason: "missing-module" };
  status = "checking";
  try {
    const result = await au.checkForUpdates();
    return { ok: true, version: result?.updateInfo?.version };
  } catch (e) {
    send({ type: "error", message: e?.message || String(e) });
    return { ok: false, error: e?.message };
  } finally {
    if (status === "checking") status = pendingVersion ? "available" : "idle";
  }
};

const startDownload = async (opts = {}) => {
  if (isDev) return { ok: false, reason: "dev-build" };
  if (status === "installing") return { ok: false, reason: "install-in-progress" };
  if (isDownloadBusy()) return { ok: true, reason: "already-downloading" };
  const au = tryLoad();
  if (!au) return { ok: false, reason: "missing-module" };

  if (!pendingVersion) {
    const result = await checkForUpdates();
    if (!result.ok) return result;
    if (!pendingVersion) return { ok: false, error: "no-update-available" };
  }
  // Only the provider's update-available event authorizes a download.
  if (opts?.version && String(opts.version).replace(/^v/i, "") !== pendingVersion)
    return { ok: false, error: "no-update-available" };
  if (isDownloadBusy()) return { ok: true, reason: "already-downloading" };

  if (status === "ready") {
    send({ type: "ready", version: pendingVersion });
    return { ok: true, reason: "already-downloaded" };
  }

  status = "downloading";
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
      return { ok: true };
    } catch (e) {
      if (status === "downloading") status = "retrying";
      if (
        !INTEGRITY_ERRORS.has(e?.code) &&
        attempt < MAX_DOWNLOAD_RETRIES &&
        pendingVersion &&
        status !== "ready"
      ) {
        const delay = BASE_RETRY_DELAY_MS * (attempt + 1);
        au.logger.warn(`Download attempt ${attempt + 1} failed; retry in ${delay}ms`, e);
        await new Promise((resolve) => setTimeout(resolve, delay));
        if (!pendingVersion || status === "ready") {
          if (status === "retrying") status = pendingVersion ? "available" : "idle";
          return { ok: false, reason: "aborted" };
        }
        status = "downloading";
        send({ type: "downloading", version: pendingVersion, percent: 0 });
        continue;
      }
      if (status === "retrying") status = pendingVersion ? "available" : "idle";
      send({ type: "error", message: errorMessage(e), recoverTo: "available" });
      return { ok: false, error: errorMessage(e) };
    }
  }
};

const getSnapshot = () => lastSnapshot;

const INSTALL_GRACE_MS = 10000;

const abortInstall = (e, attempt = installAttempt) => {
  if (status !== "installing" || attempt !== installAttempt) return;
  clearTimeout(installTimer);
  status = "ready";
  setAppIsQuitting(false);
  send({ type: "error", message: e?.message || String(e), recoverTo: "ready" });
};

const scheduleInstall = (au) => {
  if (isDev || !au || status === "installing") return;
  const attempt = ++installAttempt;
  status = "installing";
  setAppIsQuitting(true);
  // NSIS oneClick:false requires the wizard; silent install relaunches the old build.
  setImmediate(() => {
    Promise.resolve()
      .then(() => cancelRun())
      .then(() => {
        if (status !== "installing" || attempt !== installAttempt) return;
        return au.quitAndInstall(false, true);
      })
      .catch((error) => abortInstall(error, attempt));
  });
  // NSIS may fail to spawn without rejecting; unlock for retry if the app stays alive.
  installTimer = setTimeout(() => {
    abortInstall(
      new Error("No se pudo reiniciar para instalar la actualización. Inténtalo de nuevo."),
      attempt,
    );
  }, INSTALL_GRACE_MS);
};

const install = () => {
  if (isDev) return { ok: false, reason: "dev-build" };
  if (status === "installing") return { ok: false, reason: "install-in-progress" };
  if (status !== "ready") return { ok: false, error: "update-not-downloaded" };
  const au = tryLoad();
  if (!au) return { ok: false, reason: "missing-module" };
  scheduleInstall(au);
  return { ok: true };
};

const isQuittingForUpdate = () => status === "installing";

export { init, checkForUpdates, startDownload, install, getSnapshot, isQuittingForUpdate };
