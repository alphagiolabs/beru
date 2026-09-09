import path from "path";
import fs from "fs";
import { VIDEO_EXT } from "../../shared/video-extensions.js";

export { VIDEO_EXT };
const MAX_FOLDER_DEPTH = 8;
const MAX_FILES_PER_DROP = 500;

export async function collectVideoFiles(root, depth, out) {
  if (depth > MAX_FOLDER_DEPTH || out.length >= MAX_FILES_PER_DROP) return;
  let entries = [];
  try {
    entries = await fs.promises.readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (out.length >= MAX_FILES_PER_DROP) return;
    const full = path.join(root, ent.name);
    if (ent.isDirectory()) {
      if (
        ent.name.startsWith(".") ||
        ent.name === "node_modules" ||
        ent.name === "System Volume Information"
      )
        continue;
      await collectVideoFiles(full, depth + 1, out);
    } else if (ent.isFile() && VIDEO_EXT.test(ent.name)) {
      out.push(full);
    }
  }
}
