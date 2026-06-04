import { app, BrowserWindow, protocol } from "electron";
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
import { registerProjectHandlers } from "./handlers/project.js";
import { registerPresetHandlers } from "./handlers/preset.js";
import { registerSettingsHandlers } from "./handlers/settings.js";
import { registerRecentHandlers } from "./handlers/recent.js";
import { registerSystemHandlers } from "./handlers/system.js";
import { registerUpdaterHandlers } from "./handlers/updater.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;
let quitCleanupStarted = false;

const pathSecurity = createPathSecurity(app);

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

// ── App lifecycle ─────────────────────────────────────────────────────────

process.on("uncaughtException", (err) => {
  console.error("[beru] uncaughtException:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("[beru] unhandledRejection:", reason);
});

app.whenReady().then(() => {
  registerBeruProtocol();
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", (event) => {
  if (quitCleanupStarted || !getPythonProcess()) return;
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
registerSystemHandlers();
registerUpdaterHandlers();
