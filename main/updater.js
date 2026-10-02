import { createRequire } from "module";
import { getMainWindow, isDev, setAppIsQuitting } from "./shared-state.js";
import { cancelRun } from "./processing-run.js";
import { IPC_EVENTS } from "../shared/ipc-channels.js";
const requireCJS = createRequire(import.meta.url);

let autoUpdater = null;
let initialized = false;
let lastSnapshot = null;
let pendingVersion = null;

let status = "idle";

const isDownloadBusy = () => status === "downloading" || status === "retrying";

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
      win.webContents.send(IPC_EVENTS.onUpdaterEvent, payload);
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
  // NsisUpdater.verifySignature needs a logger to report the original error.
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
    if (status === "ready" && pendingVersion && version === pendingVersion) {
      send({ type: "ready", version: pendingVersion });
      return;
    }
    if (!isDownloadBusy() && status !== "installing") status = "available";
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
    if (status === "checking") status = pendingVersion ? "available" : "idle";
    else if (status === "downloading") status = "retrying";
    send({ type: "error", message: err?.message || String(err) });
  });

  checkForUpdates().catch(() => {});
};

const checkForUpdates = async () => {
  if (isDev) return { ok: false, reason: "dev-build" };
  if (status === "ready") return { ok: false, reason: "already-ready" };
  if (status === "downloading") return { ok: false, reason: "download-in-progress" };
  if (pendingVersion) {
    send({
      type: "available",
      version: pendingVersion,
      releaseDate: lastSnapshot?.releaseDate,
      releaseNotes: lastSnapshot?.releaseNotes || "",
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
  if (isDownloadBusy()) return { ok: true, reason: "already-downloading" };
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
      if (attempt < MAX_DOWNLOAD_RETRIES && pendingVersion && status !== "ready") {
        const delay = BASE_RETRY_DELAY_MS * (attempt + 1);
        send({
          type: "error",
          message: `Download failed (attempt ${attempt + 1}/${MAX_DOWNLOAD_RETRIES + 1}). Retrying in ${delay / 1000}s...`,
        });
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
      // electron-updater emits "error" for download failures; avoid duplicate IPC.
      return { ok: false, error: e?.message };
    }
  }
};

const getSnapshot = () => lastSnapshot;

const INSTALL_GRACE_MS = 10000;

const scheduleInstall = (au) => {
  if (isDev || !au || status === "installing") return;
  status = "installing";
  setAppIsQuitting(true);
  const abortInstall = (e) => {
    if (status !== "installing") return;
    status = "ready";
    setAppIsQuitting(false);
    send({ type: "error", message: e?.message || String(e) });
  };
  // NSIS oneClick:false requires the wizard; silent install relaunches the old build.
  setImmediate(() => {
    Promise.resolve(cancelRun())
      .catch((e) => {
        console.error("[updater] cancel before install failed:", e?.message || e);
      })
      .finally(() => {
        try {
          const result = au.quitAndInstall(false, true);
          if (result && typeof result.catch === "function") {
            result.catch((e) => abortInstall(e));
          }
        } catch (e) {
          abortInstall(e);
        }
      });
  });
  // NSIS may fail to spawn without rejecting; unlock for retry if the app stays alive.
  setTimeout(() => {
    if (status === "installing") {
      status = "ready";
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
  if (status === "installing") return { ok: false, reason: "install-in-progress" };
  if (status !== "ready") return { ok: false, error: "update-not-downloaded" };
  const au = tryLoad();
  if (!au) return { ok: false, reason: "missing-module" };
  scheduleInstall(au);
  return { ok: true };
};

const isQuittingForUpdate = () => status === "installing";

export { init, checkForUpdates, startDownload, install, getSnapshot, isQuittingForUpdate };
