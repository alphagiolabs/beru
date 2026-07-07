import { BrowserWindow } from "electron";
import path from "path";
import { fileURLToPath } from "url";
import { getMainWindow, isDev } from "../shared-state.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEV_URL = process.env.BERU_DEV_URL || `http://localhost:${process.env.BERU_DEV_PORT || 5173}`;
const BUILD_OVERLAY = path.join(__dirname, "..", "..", "build", "pet-overlay.html");

let overlayWindow = null;
let lastSyncPayload = null;

export function getPetOverlayWindow() {
  return overlayWindow;
}

export function getLastPetOverlayPayload() {
  return lastSyncPayload;
}

export function syncPetOverlay(payload) {
  lastSyncPayload = payload;
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send("petOverlay:state", payload);
  }
}

function notifyMainWindow(event, data) {
  const main = getMainWindow();
  if (main && !main.isDestroyed()) {
    main.webContents.send("petOverlay:event", { event, ...data });
  }
}

function loadOverlayUrl(win) {
  if (isDev) {
    win.loadURL(`${DEV_URL}/pet-overlay.html`);
    return;
  }
  win.loadFile(BUILD_OVERLAY);
}

export function createPetOverlayWindow(position) {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    if (position && Number.isFinite(position.x) && Number.isFinite(position.y)) {
      overlayWindow.setPosition(Math.floor(position.x), Math.floor(position.y), false);
    }
    overlayWindow.show();
    if (lastSyncPayload) syncPetOverlay(lastSyncPayload);
    return overlayWindow;
  }

  const x = Number.isFinite(position?.x) ? Math.floor(position.x) : 80;
  const y = Number.isFinite(position?.y) ? Math.floor(position.y) : 80;

  overlayWindow = new BrowserWindow({
    width: 300,
    height: 340,
    x,
    y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    focusable: true,
    show: false,
    backgroundColor: "#00000000",
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      preload: path.join(__dirname, "..", "preload.cjs"),
    },
  });

  overlayWindow.setAlwaysOnTop(true, "floating");
  overlayWindow.setMenu(null);
  loadOverlayUrl(overlayWindow);

  overlayWindow.webContents.once("did-finish-load", () => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.show();
      if (lastSyncPayload) syncPetOverlay(lastSyncPayload);
    }
  });

  overlayWindow.on("closed", () => {
    overlayWindow = null;
    notifyMainWindow("closed");
  });

  return overlayWindow;
}

export function closePetOverlayWindow() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.close();
  }
  overlayWindow = null;
}

export function isPetOverlayOpen() {
  return Boolean(overlayWindow && !overlayWindow.isDestroyed());
}

export function reportOverlayPosition(position) {
  notifyMainWindow("position", { position });
}

export function reportOverlayPopIn() {
  closePetOverlayWindow();
  notifyMainWindow("popIn");
}

export function dragPetOverlayWindow(delta) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return null;
  const dx = Number(delta?.dx) || 0;
  const dy = Number(delta?.dy) || 0;
  const [x, y] = overlayWindow.getPosition();
  const next = { x: Math.max(0, Math.floor(x + dx)), y: Math.max(0, Math.floor(y + dy)) };
  overlayWindow.setPosition(next.x, next.y, false);
  notifyMainWindow("position", { position: next });
  return next;
}
