import { IPC_INVOKE } from "../../shared/ipc-channels.js";
import { handleIpc } from "../utils/ipc.js";
import {
  closePetOverlayWindow,
  createPetOverlayWindow,
  dragPetOverlayWindow,
  getLastPetOverlayPayload,
  isPetOverlayOpen,
  reportOverlayPopIn,
  syncPetOverlay,
} from "../utils/pet-overlay.js";

export function registerPetOverlayHandlers() {
  handleIpc(IPC_INVOKE.openPetOverlay, async (_event, position) => {
    createPetOverlayWindow(position);
    return { success: true, open: true };
  });

  handleIpc(IPC_INVOKE.closePetOverlay, async () => {
    closePetOverlayWindow();
    return { success: true, open: false };
  });

  handleIpc(IPC_INVOKE.togglePetOverlay, async (_event, position) => {
    if (isPetOverlayOpen()) {
      closePetOverlayWindow();
      return { success: true, open: false };
    }
    createPetOverlayWindow(position);
    return { success: true, open: true };
  });

  handleIpc(IPC_INVOKE.syncPetOverlayState, async (_event, payload) => {
    syncPetOverlay(payload);
    return { success: true };
  });

  handleIpc(IPC_INVOKE.getPetOverlayState, async () => {
    return { success: true, state: getLastPetOverlayPayload() };
  });

  handleIpc(IPC_INVOKE.popInPetOverlay, async () => {
    reportOverlayPopIn();
    return { success: true };
  });

  handleIpc(IPC_INVOKE.dragPetOverlayBy, async (_event, delta) => {
    const position = dragPetOverlayWindow(delta);
    return { success: true, position };
  });
}
