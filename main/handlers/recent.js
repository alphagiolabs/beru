import { ipcMain } from "electron";
import path from "path";
import fs from "fs";
import { readRecent, writeRecent } from "../utils/recent.js";
import { IPC_INVOKE } from "../../shared/ipc-channels.js";
import { handleIpc } from "../utils/ipc.js";

export function registerRecentHandlers() {
  ipcMain.handle(IPC_INVOKE.listRecent, async () => {
    const list = readRecent();
    return list.map((r) => ({ ...r, exists: fs.existsSync(r.path) }));
  });

  handleIpc(IPC_INVOKE.addRecent, async (_event, entry) => {
    if (!entry || typeof entry.path !== "string" || !entry.path.trim()) {
      return { success: false, error: "Path inválido" };
    }
    const norm = path.normalize(entry.path);
    const list = readRecent().filter((r) => path.normalize(r.path) !== norm);
    const next = [
      {
        path: norm,
        name: typeof entry.name === "string" && entry.name ? entry.name : path.basename(norm),
        savedAt: new Date().toISOString(),
      },
      ...list,
    ].slice(0, 8);
    writeRecent(next);
    return { success: true, recent: next };
  });

  handleIpc(IPC_INVOKE.removeRecent, async (_event, p) => {
    if (typeof p !== "string" || !p.trim()) return { success: false, error: "Path inválido" };
    const norm = path.normalize(p);
    const list = readRecent().filter((r) => path.normalize(r.path) !== norm);
    writeRecent(list);
    return { success: true, recent: list };
  });
}
