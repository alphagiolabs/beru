import { ipcMain } from "electron";

export function handleIpc(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return await fn(event, ...args);
    } catch (err) {
      console.error(`[beru] ipc ${channel} failed:`, err?.message || err);
      return { success: false, error: err?.message || String(err) };
    }
  });
}
