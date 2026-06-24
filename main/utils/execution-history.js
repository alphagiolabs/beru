import { app } from "electron";
import path from "path";
import fs from "fs";

const HISTORY_MAX = 40;

function historyFilePath() {
  return path.join(app.getPath("userData"), "execution-history.json");
}

export function readExecutionHistory() {
  try {
    const file = historyFilePath();
    if (!fs.existsSync(file)) return [];
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((run) => run && typeof run.id === "string" && typeof run.startedAt === "string")
      .slice(0, HISTORY_MAX);
  } catch {
    return [];
  }
}

export function writeExecutionHistory(runs) {
  const file = historyFilePath();
  const safe = Array.isArray(runs)
    ? runs.filter((run) => run && typeof run.id === "string").slice(0, HISTORY_MAX)
    : [];
  // Atomic write (sibling tmp + rename) so a crash mid-write cannot truncate
  // the history file and silently wipe the user's execution history.
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(safe, null, 2), "utf8");
  fs.renameSync(tmp, file);
}
