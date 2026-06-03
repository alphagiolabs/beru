import { BrowserWindow } from "electron";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { setMainWindow, isDev } from "../shared-state.js";
import * as updater from "../updater.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEV_URL = "http://localhost:5173";
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
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    title: "Beru",
    icon: path.join(__dirname, "..", "..", "brand", "icon.ico"),
    backgroundColor: "#0a0a0a",
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, "..", "preload.cjs"),
    },
  });
  win.setMenu(null);
  setMainWindow(win);

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

  updater.init(win);
}
