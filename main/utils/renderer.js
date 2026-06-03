import { getMainWindow } from "../shared-state.js";

export function sendToRenderer(channel, data) {
  try {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, data);
    }
  } catch (e) {
    console.error("[beru] IPC send failed:", channel, e.message);
  }
}
