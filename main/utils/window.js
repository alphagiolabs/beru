import { BrowserWindow, dialog } from "electron";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { setMainWindow, isDev, hasActiveProcessing } from "../shared-state.js";
import { cancelActiveProcessing } from "../handlers/process.js";
import { readSettings } from "./settings.js";
import { applyWindowTheme, resolveWindowTheme, TITLEBAR_OVERLAY_COLOR } from "./windowTheme.js";
import * as updater from "../updater.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEV_URL = process.env.BERU_DEV_URL || `http://localhost:${process.env.BERU_DEV_PORT || 5173}`;
const BUILD_INDEX = path.join(__dirname, "..", "..", "build", "index.html");

function loadProductionBuild(win) {
  if (!fs.existsSync(BUILD_INDEX)) {
    console.error("[beru] Missing build/index.html — run: npm run build");
    return false;
  }
  win.loadFile(BUILD_INDEX);
  return true;
}

export function createWindow() {
  // Read settings once; the theme is applied to the constructor background and
  // re-applied after did-finish-load (setTitleBarOverlay can fail before the
  // window is fully ready). No need for a mid-creation apply.
  const theme = readSettings().theme;
  const initialTheme = resolveWindowTheme(theme);
  const useOverlay = process.platform === "win32" || process.platform === "darwin";

  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    title: "Beru",
    icon: path.join(__dirname, "..", "..", "brand", "icon.ico"),
    backgroundColor: initialTheme.background,
    autoHideMenuBar: true,
    ...(useOverlay
      ? {
          titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
          titleBarOverlay: {
            color: TITLEBAR_OVERLAY_COLOR,
            symbolColor: initialTheme.symbols,
            height: 32,
          },
        }
      : {}),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      preload: path.join(__dirname, "..", "preload.cjs"),
    },
  });
  win.setMenu(null);
  setMainWindow(win);

  let closeConfirmed = false;
  win.on("close", (event) => {
    if (closeConfirmed) return;
    if (updater.isQuittingForUpdate()) return;
    if (!hasActiveProcessing()) return;

    event.preventDefault();
    dialog
      .showMessageBox(win, {
        type: "warning",
        buttons: ["Cancelar y salir", "Seguir procesando"],
        defaultId: 1,
        cancelId: 1,
        title: "Beru",
        message: "Hay un procesamiento en curso. ¿Cancelar y salir?",
        detail: "Si sales ahora, el lote actual se cancelará.",
      })
      .then(async ({ response }) => {
        if (response !== 0) return;
        closeConfirmed = true;
        try {
          await cancelActiveProcessing();
        } catch (e) {
          console.error("[beru] cancel on close failed:", e?.message || e);
        }
        if (!win.isDestroyed()) win.close();
      })
      .catch((e) => {
        console.error("[beru] close confirm dialog failed:", e?.message || e);
      });
  });

  let devFallbackUsed = false;
  if (isDev) {
    win.webContents.on(
      "did-fail-load",
      (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        if (!isMainFrame || devFallbackUsed) return;
        if (!validatedURL?.startsWith(DEV_URL)) return;
        devFallbackUsed = true;
        console.warn(
          `[beru] Dev server unavailable (${errorCode} ${errorDescription}). ` +
            "Loading build/ — start Vite with: npm run dev",
        );
        loadProductionBuild(win);
      },
    );
    win.loadURL(DEV_URL);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    loadProductionBuild(win);
  }

  win.webContents.once("did-finish-load", () => {
    applyWindowTheme(win, theme);
    updater.init(win);
  });
}
