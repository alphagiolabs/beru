import { ipcMain } from "electron";
import fs from "fs";
import { collectVideoFilesSync, VIDEO_EXT } from "../utils/drop-resolver.js";

export function registerDropHandlers(pathSecurity) {
  ipcMain.handle("fs:resolveDroppedPaths", async (_event, inputPaths) => {
    if (!Array.isArray(inputPaths) || inputPaths.length === 0) {
      return { videoPaths: [], ignoredCount: 0 };
    }
    const videoPaths = [];
    let ignoredCount = 0;
    for (const p of inputPaths) {
      if (!p || typeof p !== "string") {
        ignoredCount++;
        continue;
      }
      let stat;
      try {
        stat = fs.statSync(p);
      } catch {
        ignoredCount++;
        continue;
      }
      if (stat.isDirectory()) {
        const before = videoPaths.length;
        collectVideoFilesSync(p, 0, videoPaths);
        if (videoPaths.length === before) ignoredCount++;
      } else if (stat.isFile()) {
        if (VIDEO_EXT.test(p)) videoPaths.push(p);
        else ignoredCount++;
      } else {
        ignoredCount++;
      }
    }
    pathSecurity.registerAllowedPaths(videoPaths, "video");
    return { videoPaths, ignoredCount };
  });
}
