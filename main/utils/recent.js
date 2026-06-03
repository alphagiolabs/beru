import { app } from "electron";
import path from "path";
import fs from "fs";

const RECENT_MAX = 8;

export function readRecent() {
  try {
    const file = path.join(app.getPath("userData"), "recent.json");
    if (!fs.existsSync(file)) return [];
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((r) => r && typeof r.path === "string" && typeof r.name === "string")
      .slice(0, RECENT_MAX);
  } catch {
    return [];
  }
}

export function writeRecent(arr) {
  const file = path.join(app.getPath("userData"), "recent.json");
  fs.writeFileSync(file, JSON.stringify(arr, null, 2), "utf8");
}
