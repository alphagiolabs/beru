import { app, BrowserWindow, protocol } from "electron";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createPathSecurity } from "./pathSecurity.js";
import { getPythonProcess } from "./shared-state.js";
import { createBeruVideoResponse, validateBeruRequestPath } from "./utils/beru-protocol.js";
import { createWindow } from "./utils/window.js";

import { registerDialogHandlers } from "./handlers/dialog.js";
import { registerVideoHandlers } from "./handlers/video.js";
import { registerDropHandlers } from "./handlers/drop.js";
import { registerFileHandlers } from "./handlers/file.js";
import { cancelActiveProcessing, registerProcessHandlers } from "./handlers/process.js";
import { disposePreviewFrameWorker } from "./utils/preview-frame.js";
import { registerProjectHandlers } from "./handlers/project.js";
import { registerPresetHandlers } from "./handlers/preset.js";
import { registerSettingsHandlers } from "./handlers/settings.js";
import { registerRecentHandlers } from "./handlers/recent.js";
import { registerExecutionHistoryHandlers } from "./handlers/execution-history.js";
import { registerSystemHandlers } from "./handlers/system.js";
import { registerUpdaterHandlers } from "./handlers/updater.js";
import { registerPetdexHandlers } from "./handlers/petdex.js";
import { registerPetOverlayHandlers } from "./handlers/pet-overlay.js";
import { closePetOverlayWindow } from "./utils/pet-overlay.js";
import { isQuittingForUpdate } from "./updater.js";
import { initTelemetry } from "./utils/telemetry.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let quitCleanupStarted = false;
let quitDisposalDone = false;

const pathSecurity = createPathSecurity(app);

// ── Global cleanup helpers ───────────────────────────────────────────

function cleanupTempFiles() {
  try {
    const tmpDir = app.getPath("temp");
    const files = fs.readdirSync(tmpDir);
    for (const f of files) {
      if (f.startsWith("beru-jobs-") && (f.endsWith(".json") || f.endsWith(".cancel"))) {
        try {
          fs.unlinkSync(path.join(tmpDir, f));
        } catch {}
      }
    }
  } catch {}
}

// Unconditional quit-time disposal. Runs on EVERY quit path (not just when a
// processing run is active): the preview-frame worker is a separate long-lived
// child that getPythonProcess() does not track, so gating on it orphaned the
// worker on every normal quit while idle. Idempotent across before-quit/will-quit.
function disposeOnQuit() {
  if (quitDisposalDone) return;
  quitDisposalDone = true;
  try {
    cleanupTempFiles();
  } catch {}
  try {
    disposePreviewFrameWorker();
  } catch {}
  try {
    closePetOverlayWindow();
  } catch {}
}

function onFatalError(err) {
  console.error("[beru] FATAL:", err);
  // Write crash info to a log file for post-mortem debugging.
  // Future: integrate electron's crashReporter or Sentry for remote crash reporting.
  try {
    const crashLog = path.join(app.getPath("userData"), "crash.log");
    const entry = `[${new Date().toISOString()}] ${err?.stack || err?.message || String(err)}\n`;
    fs.appendFileSync(crashLog, entry, "utf-8");
  } catch {}
  try {
    cleanupTempFiles();
    disposePreviewFrameWorker();
    const proc = getPythonProcess();
    if (proc?.pid) {
      try {
        proc.kill();
      } catch {}
    }
  } catch {}
  app.quit();
}

app.on("will-quit", (event) => {
  if (quitCleanupStarted) return;
  if (isQuittingForUpdate()) return;
  disposeOnQuit();
  if (!getPythonProcess()) return;
  event.preventDefault();
  quitCleanupStarted = true;
  cancelActiveProcessing().finally(() => {
    app.quit();
  });
});

app.on("render-process-gone", (event, _webContents, details) => {
  console.error("[beru] renderer process gone:", details.reason, details.exitCode);
});

// ── Register beru:// protocol before app is ready ────────────────────────────
protocol.registerSchemesAsPrivileged([
  {
    scheme: "beru",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: false,
    },
  },
]);

function registerBeruProtocol() {
  protocol.handle("beru", async (request) => {
    try {
      const check = validateBeruRequestPath(pathSecurity, request.url);
      if (!check.ok) {
        const status = check.error === "Archivo no encontrado" ? 404 : 403;
        return new Response(check.error, { status });
      }
      return createBeruVideoResponse(check.resolvedPath, request);
    } catch (err) {
      console.error("[beru] beru:// handler error:", err);
      return new Response("Internal error", { status: 500 });
    }
  });
}

// ── Suppress GPU shader disk cache errors on Windows ────────────────────────
app.commandLine.appendSwitch("disable-gpu-shader-disk-cache");

// Windows Task Manager and shell use the packaged exe FileDescription (set at
// build time from package.json description). Keep app identity consistent in dev.
app.setName("Beru");
if (process.platform === "win32") {
  app.setAppUserModelId("app.beru.desktop");
}

// ── App lifecycle ─────────────────────────────────────────────────────────

process.on("uncaughtException", onFatalError);
process.on("unhandledRejection", onFatalError);

app.whenReady().then(() => {
  registerBeruProtocol();
  initTelemetry();
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", (event) => {
  if (quitCleanupStarted || isQuittingForUpdate()) return;
  disposeOnQuit();
  if (!getPythonProcess()) return;
  event.preventDefault();
  quitCleanupStarted = true;
  cancelActiveProcessing().finally(() => app.quit());
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ── IPC Handlers ──────────────────────────────────────────────────────────

registerDialogHandlers(pathSecurity);
registerVideoHandlers(pathSecurity);
registerDropHandlers(pathSecurity);
registerFileHandlers(pathSecurity);
registerProcessHandlers(pathSecurity);
registerProjectHandlers(pathSecurity);
registerPresetHandlers();
registerSettingsHandlers();
registerRecentHandlers();
registerExecutionHistoryHandlers();
registerSystemHandlers();
registerUpdaterHandlers();
registerPetdexHandlers();
registerPetOverlayHandlers();
