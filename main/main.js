import { requireWindows } from "../shared/platform.js";
import { app, BrowserWindow, protocol } from "electron";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createPathSecurity } from "./pathSecurity.js";
import { setAppIsQuitting } from "./shared-state.js";
import { cancelRun, getPythonProcess, hasActiveProcessing } from "./processing-run.js";
import { sweepOrphanedArtifacts } from "./utils/cancel-artifacts.js";
import {
  createBeruVideoResponse,
  hasKnownBeruType,
  validateBeruRequestPath,
} from "./utils/beru-protocol.js";

import { killProcessTree } from "./utils/kill-process-tree.js";
import { createWindow } from "./utils/window.js";

import { registerDialogHandlers } from "./handlers/dialog.js";
import { registerVideoHandlers } from "./handlers/video.js";
import { registerDropHandlers } from "./handlers/drop.js";
import { registerFileHandlers } from "./handlers/file.js";
import { registerProcessHandlers } from "./handlers/process.js";
import { disposePreviewFrameWorker } from "./utils/preview-frame-cache.js";
import { disposeJobWorker } from "./utils/job-worker.js";
import { registerProjectHandlers } from "./handlers/project.js";
import { registerPresetHandlers } from "./handlers/preset.js";
import { registerSettingsHandlers } from "./handlers/settings.js";
import { registerRecentHandlers } from "./handlers/recent.js";
import { registerSystemHandlers } from "./handlers/system.js";
import { registerUpdaterHandlers } from "./handlers/updater.js";
import { disposePetsModule, registerPetsModule } from "./pets/index.js";
import { isQuittingForUpdate } from "./updater.js";

let quitPhase = "running";
let fatalHandling = false;
let writingDiagnostic = false;

requireWindows();

const MAX_CRASH_LOG_BYTES = 64 * 1024;
const FATAL_ERROR_CODES = new Set(["EPIPE", "ENOSPC", "ENOMEM", "EACCES", "EPERM"]);
const RENDERER_EXIT_REASONS = new Set([
  "clean-exit",
  "abnormal-exit",
  "killed",
  "crashed",
  "oom",
  "launch-failed",
  "integrity-failure",
]);

const pathSecurity = createPathSecurity(app);

function disposeOnQuit() {
  if (quitPhase === "disposed") return;
  quitPhase = "disposed";
  try {
    sweepOrphanedArtifacts(app.getPath("temp"));
  } catch {}
  try {
    disposePreviewFrameWorker();
  } catch {}
  try {
    disposeJobWorker();
  } catch {}
  try {
    disposePetsModule();
  } catch {}
}

function recordDiagnostic(event, detail) {
  if (writingDiagnostic) return;
  writingDiagnostic = true;
  try {
    const crashLog = path.join(app.getPath("userData"), "crash.log");
    const entry = `[${new Date().toISOString()}] ${event} ${detail}\n`;
    let size = 0;
    try {
      size = fs.statSync(crashLog).size;
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
    if (size + Buffer.byteLength(entry, "utf8") > MAX_CRASH_LOG_BYTES) {
      fs.writeFileSync(crashLog, entry, "utf8");
    } else {
      fs.appendFileSync(crashLog, entry, "utf8");
    }
  } catch {
  } finally {
    writingDiagnostic = false;
  }
}

function mainStackFrames(err) {
  const frames = [];
  try {
    if (typeof err?.stack !== "string") return frames;
    const mainDir = path.join(app.getAppPath(), "main");
    for (const line of err.stack.slice(0, 16384).split("\n")) {
      const frame = line.trim();
      if (!frame.startsWith("at ")) continue;
      const site = frame.slice(3);
      let location = site.endsWith(")") ? site.slice(site.lastIndexOf("(") + 1, -1) : site;
      const match = location.match(/^(.*):([1-9]\d{0,6}):([1-9]\d{0,4})$/);
      if (!match) continue;
      location = match[1].startsWith("file://") ? fileURLToPath(match[1]) : match[1];
      if (!path.isAbsolute(location)) continue;
      const relative = path.relative(mainDir, location);
      const modulePath = relative.replaceAll("\\", "/");
      if (!/^[a-zA-Z0-9_./-]+\.m?js$/.test(modulePath) || modulePath.startsWith("../")) continue;
      frames.push(`main/${modulePath}:${match[2]}:${match[3]}`);
      if (frames.length === 2) break;
    }
  } catch {}
  return frames;
}

function onFatalError(kind, err) {
  if (fatalHandling) return;
  fatalHandling = true;
  const code = FATAL_ERROR_CODES.has(err?.code) ? err.code : "unknown";
  recordDiagnostic("fatal", `${kind} ${code} ${mainStackFrames(err).join(" ")}`);
  try {
    sweepOrphanedArtifacts(app.getPath("temp"));
    disposePreviewFrameWorker();
    disposeJobWorker();
    const proc = getPythonProcess();
    if (proc?.pid) {
      void Promise.resolve(killProcessTree(proc)).catch(() => {});
    }
  } catch {}
  if (quitPhase === "running") quitPhase = "quitting";
  app.quit();
}

function interceptQuitIfProcessing(event) {
  if (quitPhase === "running") quitPhase = "quitting";
  if (quitPhase === "cancelling" || quitPhase === "disposed") return;
  if (isQuittingForUpdate()) return;

  if (!hasActiveProcessing()) {
    disposeOnQuit();
    return;
  }

  event.preventDefault();
  quitPhase = "cancelling";
  setAppIsQuitting(true);
  cancelRun().finally(() => {
    disposeOnQuit();
    app.quit();
  });
}

app.on("will-quit", (event) => {
  interceptQuitIfProcessing(event);
});

app.on("render-process-gone", (_event, _webContents, details) => {
  const reason = RENDERER_EXIT_REASONS.has(details?.reason) ? details.reason : "unknown";
  const exitCode = Number.isSafeInteger(details?.exitCode) ? details.exitCode : "unknown";
  recordDiagnostic(
    "renderer-gone",
    `${quitPhase !== "running" ? "requested" : "unexpected"} ${reason} ${exitCode}`,
  );
});

protocol.registerSchemesAsPrivileged([
  {
    scheme: "beru",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: false,
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
      if (!hasKnownBeruType(check.resolvedPath)) {
        return new Response("Tipo de contenido no permitido", { status: 403 });
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
app.setAppUserModelId("app.beru.desktop");

process.on("uncaughtException", (err) => onFatalError("uncaughtException", err));
process.on("unhandledRejection", (err) => onFatalError("unhandledRejection", err));

app.whenReady().then(() => {
  registerBeruProtocol();
  createWindow();
});

app.on("window-all-closed", () => {
  if (quitPhase === "running") quitPhase = "quitting";
  app.quit();
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
registerSystemHandlers();
registerUpdaterHandlers();
registerPetsModule();
