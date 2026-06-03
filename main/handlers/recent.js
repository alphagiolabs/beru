import { ipcMain } from "electron";
import path from "path";
import fs from "fs";
import { readRecent, writeRecent } from "../utils/recent.js";

export function registerRecentHandlers() {
  ipcMain.handle("recent:list", async () => {
    const list = readRecent();
    return list.map((r) => {
      let exists = true;
      try {
        exists = fs.existsSync(r.path);
      } catch {
        exists = false;
      }
      return { ...r, exists };
    });
  });

  ipcMain.handle("recent:add", async (_event, entry) => {
    try {
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
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle("recent:remove", async (_event, p) => {
    try {
      if (typeof p !== "string" || !p.trim()) return { success: false, error: "Path inválido" };
      const norm = path.normalize(p);
      const list = readRecent().filter((r) => path.normalize(r.path) !== norm);
      writeRecent(list);
      return { success: true, recent: list };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
}
