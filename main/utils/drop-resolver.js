import path from "path";
import fs from "fs";

export const VIDEO_EXT = /\.(mp4|mov|avi|mkv|webm|flv|wmv|m4v|mpg|mpeg)$/i;
const MAX_FOLDER_DEPTH = 8;
const MAX_FILES_PER_DROP = 500;

export function collectVideoFilesSync(root, depth, out) {
  if (depth > MAX_FOLDER_DEPTH || out.length >= MAX_FILES_PER_DROP) return;
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (out.length >= MAX_FILES_PER_DROP) return;
    const full = path.join(root, ent.name);
    if (ent.isDirectory()) {
      // skip hidden / system / node_modules
      if (
        ent.name.startsWith(".") ||
        ent.name === "node_modules" ||
        ent.name === "System Volume Information"
      )
        continue;
      collectVideoFilesSync(full, depth + 1, out);
    } else if (ent.isFile() && VIDEO_EXT.test(ent.name)) {
      out.push(full);
    }
  }
}
