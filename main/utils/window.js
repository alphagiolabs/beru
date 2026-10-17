import { BrowserWindow, dialog } from "electron";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { setMainWindow, getHasUnexportedWork, isDev, DEV_URL } from "../shared-state.js";
import { cancelRun, hasActiveProcessing } from "../processing-run.js";
import { readSettings } from "./settings.js";
import {
  applyWindowTheme,
  resolveWindowTheme,
  TITLEBAR_OVERLAY_COLOR,
  TITLEBAR_OVERLAY_HEIGHT,
} from "./windowTheme.js";
import * as updater from "../updater.js";
import { requestCloseConfirm } from "./closeConfirm.js";
import { IPC_EVENTS } from "../../shared/ipc-channels.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BUILD_INDEX = path.join(__dirname, "..", "..", "build", "index.html");

function loadProductionBuild(win) {
  if (!fs.existsSync(BUILD_INDEX)) {
    console.error("[beru] Missing build/index.html — run: npm run build");
    return;
  }
  win.loadFile(BUILD_INDEX);
}

function isOwnDocumentUrl(url, currentUrl) {
  if (!url || !currentUrl) return false;
  try {
    return new URL(url).href === new URL(currentUrl).href;
  } catch {
    return false;
  }
}

export function attachNavigationGuards(win) {
  win.webContents.on("will-navigate", (event, url) => {
    if (isOwnDocumentUrl(url, win.webContents.getURL())) return;
    event.preventDefault();
    console.error("[beru] blocked navigation to:", url);
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    console.error("[beru] blocked navigation to:", url);
    return { action: "deny" };
  });
}

// The renderer shows the styled in-app dialog; the native box is only a fallback
// for when the page cannot answer (loading, crashed or no listener mounted).
async function confirmClose(win, processing) {
  const contents = win.webContents;
  if (!contents.isLoading() && !contents.isCrashed()) {
    const answer = await requestCloseConfirm(contents, IPC_EVENTS.onCloseConfirm, { processing });
    if (answer !== null) return answer;
  }
  if (win.isDestroyed()) return false;
  return dialog
    .showMessageBox(win, {
      type: "warning",
      buttons: processing
        ? ["Cancelar y salir", "Seguir procesando"]
        : ["Salir de todas formas", "Volver"],
      defaultId: 1,
      cancelId: 1,
      title: "Beru",
      message: processing
        ? "Hay un procesamiento en curso. ¿Cancelar y salir?"
        : "Hay cambios sin guardar o videos sin exportar. ¿Salir de todas formas?",
    })
    .then(({ response }) => response === 0);
}

export function createWindow() {
  const theme = readSettings().theme;
  const initialTheme = resolveWindowTheme(theme);

  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    title: "Beru",
    icon: path.join(__dirname, "..", "..", "brand", "icon.ico"),
    backgroundColor: initialTheme.background,
    autoHideMenuBar: true,
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: TITLEBAR_OVERLAY_COLOR,
      symbolColor: initialTheme.symbols,
      height: TITLEBAR_OVERLAY_HEIGHT,
    },
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
  attachNavigationGuards(win);

  let closeConfirmed = false;
  let closePromptOpen = false;
  win.on("close", (event) => {
    if (closeConfirmed) return;
    if (updater.isQuittingForUpdate()) return;
    const processing = hasActiveProcessing();
    if (!processing && !getHasUnexportedWork()) return;

    event.preventDefault();
    if (closePromptOpen) return;
    closePromptOpen = true;
    confirmClose(win, processing)
      .then(async (confirmed) => {
        if (!confirmed) return;
        closeConfirmed = true;
        try {
          await cancelRun();
        } catch (e) {
          console.error("[beru] cancel on close failed:", e?.message || e);
        }
        if (!win.isDestroyed()) win.close();
      })
      .catch((e) => {
        console.error("[beru] close confirm dialog failed:", e?.message || e);
      })
      .finally(() => {
        closePromptOpen = false;
      });
  });
  // A reload or crash drops the in-app dialog without an answer; let the next close ask again.
  const resetClosePrompt = () => {
    closePromptOpen = false;
  };
  win.webContents.on("did-start-loading", resetClosePrompt);
  win.webContents.on("render-process-gone", resetClosePrompt);

  if (isDev) {
    const startupOpenedAt = Date.now();
    win.webContents.on("devtools-opened", () => {
      if (Date.now() - startupOpenedAt < 5000) {
        win.webContents.closeDevTools();
      }
    });
  }

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
  } else {
    loadProductionBuild(win);
  }

  win.webContents.once("did-finish-load", () => {
    applyWindowTheme(win, theme);
    updater.init();
  });
}
