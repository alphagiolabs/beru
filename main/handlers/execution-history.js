import { ipcMain } from "electron";
import { readExecutionHistory, writeExecutionHistory } from "../utils/execution-history.js";

export function registerExecutionHistoryHandlers() {
  ipcMain.handle("executionHistory:list", async () => {
    try {
      return { success: true, history: readExecutionHistory() };
    } catch (e) {
      return { success: false, error: e.message, history: [] };
    }
  });

  ipcMain.handle("executionHistory:save", async (_event, history) => {
    try {
      writeExecutionHistory(history);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle("executionHistory:clear", async () => {
    try {
      writeExecutionHistory([]);
      return { success: true, history: [] };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
}
