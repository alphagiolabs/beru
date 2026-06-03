import { app, BrowserWindow, protocol, net } from "electron";
import path from "path";
import fs from "fs";
import { fileURLToPath, pathToFileURL } from "url";
import { createPathSecurity } from "./pathSecurity.js";
import { createWindow } from "./utils/window.js";

import { registerDialogHandlers } from "./handlers/dialog.js";
import { registerVideoHandlers } from "./handlers/video.js";
import { registerDropHandlers } from "./handlers/drop.js";
import { registerFileHandlers } from "./handlers/file.js";
import { registerProcessHandlers } from "./handlers/process.js";
import { registerProjectHandlers } from "./handlers/project.js";
import { registerPresetHandlers } from "./handlers/preset.js";
import { registerSettingsHandlers } from "./handlers/settings.js";
import { registerRecentHandlers } from "./handlers/recent.js";
import { registerSystemHandlers } from "./handlers/system.js";
import { registerUpdaterHandlers } from "./handlers/updater.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;

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
      const url = new URL(request.url);
      let absPath = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
      if (process.platform === "win32" && /^\/[A-Za-z]:/.test(url.pathname)) {
        absPath = absPath.replace(/^([A-Za-z]:)/, "$1");
      }
      if (!absPath || !fs.existsSync(absPath)) {
        return new Response("Not found", { status: 404 });
      }
      return net.fetch(pathToFileURL(absPath).toString());
    } catch (err) {
      console.error("[beru] beru:// handler error:", err);
      return new Response("Internal error", { status: 500 });
    }
  });
}

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
