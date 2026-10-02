import { ipcMain } from "electron";
import fs from "fs";
import { collectVideoFiles } from "../utils/drop-resolver.js";
import { VIDEO_EXT } from "../../shared/video-extensions.js";
import { IPC_INVOKE } from "../../shared/ipc-channels.js";

export function registerDropHandlers(pathSecurity) {
  ipcMain.handle(IPC_INVOKE.resolveDroppedPaths, async (_event, inputPaths) => {
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
        stat = await fs.promises.stat(p);
      } catch {
        ignoredCount++;
        continue;
      }
      if (stat.isDirectory()) {
        const before = videoPaths.length;
        await collectVideoFiles(p, 0, videoPaths);
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
