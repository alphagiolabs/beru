import { app, BrowserWindow, protocol } from "electron";
import fs from "fs";
import path from "path";
import { createPathSecurity } from "./pathSecurity.js";
import { setAppIsQuitting } from "./shared-state.js";
import { getPythonProcess, hasActiveProcessing } from "./processing-run.js";
import { createBeruVideoResponse, validateBeruRequestPath } from "./utils/beru-protocol.js";
import { killProcessTree } from "./utils/kill-process-tree.js";
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
import { disposePetsModule, registerPetsModule } from "./pets/index.js";
import { isQuittingForUpdate } from "./updater.js";

let quitCleanupStarted = false;
let quitDisposalDone = false;

const pathSecurity = createPathSecurity(app);

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
    disposePetsModule();
  } catch {}
}

function onFatalError(err) {
  console.error("[beru] FATAL:", err);
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
      void killProcessTree(proc);
    }
  } catch {}
  app.quit();
}

function interceptQuitIfProcessing(event) {
  if (quitCleanupStarted) return;
  if (isQuittingForUpdate()) return;

  if (!hasActiveProcessing()) {
    disposeOnQuit();
    return;
  }

  event.preventDefault();
  quitCleanupStarted = true;
  setAppIsQuitting(true);
  cancelActiveProcessing().finally(() => {
    disposeOnQuit();
    app.quit();
  });
}

app.on("will-quit", (event) => {
  interceptQuitIfProcessing(event);
});

app.on("render-process-gone", (event, _webContents, details) => {
  console.error("[beru] renderer process gone:", details.reason, details.exitCode);
});

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

app.commandLine.appendSwitch("disable-gpu-shader-disk-cache");

// Task Manager uses the packaged exe FileDescription. Match it in dev.
app.setName("Beru");
if (process.platform === "win32") {
  app.setAppUserModelId("app.beru.desktop");
}

process.on("uncaughtException", onFatalError);
process.on("unhandledRejection", onFatalError);

app.whenReady().then(() => {
  registerBeruProtocol();
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", (event) => {
  interceptQuitIfProcessing(event);
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

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
registerPetsModule();
