import { ipcMain } from "electron";
import {
  closePetOverlayWindow,
  createPetOverlayWindow,
  dragPetOverlayWindow,
  getLastPetOverlayPayload,
  isPetOverlayOpen,
  reportOverlayPopIn,
  reportOverlayPosition,
  syncPetOverlay,
} from "../utils/pet-overlay.js";

export function registerPetOverlayHandlers() {
  ipcMain.handle("petOverlay:open", async (_event, position) => {
    createPetOverlayWindow(position);
    return { success: true, open: true };
  });

  ipcMain.handle("petOverlay:close", async () => {
    closePetOverlayWindow();
    return { success: true, open: false };
  });

  ipcMain.handle("petOverlay:toggle", async (_event, position) => {
    if (isPetOverlayOpen()) {
      closePetOverlayWindow();
      return { success: true, open: false };
    }
    createPetOverlayWindow(position);
    return { success: true, open: true };
  });

  ipcMain.handle("petOverlay:sync", async (_event, payload) => {
    syncPetOverlay(payload);
    return { success: true };
  });

  ipcMain.handle("petOverlay:getState", async () => {
    return { success: true, state: getLastPetOverlayPayload() };
  });

  ipcMain.handle("petOverlay:popIn", async () => {
    reportOverlayPopIn();
    return { success: true };
  });

  ipcMain.handle("petOverlay:move", async (_event, position) => {
    reportOverlayPosition(position);
    return { success: true };
  });

  ipcMain.handle("petOverlay:dragBy", async (_event, delta) => {
    const position = dragPetOverlayWindow(delta);
    return { success: true, position };
  });
}
