import { app, dialog } from "electron";
import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "./atomic-json.js";

function historyFile() {
  return path.join(app.getPath("userData"), "dialog-directory.json");
}

function initialPath(defaultPath) {
  if (defaultPath && path.isAbsolute(defaultPath)) return defaultPath;
  let directory = app.getPath("home");
  try {
    const saved = JSON.parse(fs.readFileSync(historyFile(), "utf8")).directory;
    if (typeof saved === "string" && path.isAbsolute(saved) && fs.statSync(saved).isDirectory()) {
      directory = saved;
    }
  } catch {}
  return defaultPath ? path.join(directory, defaultPath) : directory;
}

function remember(directory) {
  try {
    writeJsonAtomic(historyFile(), { directory });
  } catch (error) {
    console.warn("[beru] Could not remember dialog directory:", error.message);
  }
}

export async function showOpenDialog(window, options) {
  const result = await dialog.showOpenDialog(window, {
    ...options,
    defaultPath: initialPath(options.defaultPath),
  });
  if (!result.canceled && result.filePaths?.length) {
    const selected = result.filePaths[0];
    remember(options.properties?.includes("openDirectory") ? selected : path.dirname(selected));
  }
  return result;
}

export async function showSaveDialog(window, options) {
  const result = await dialog.showSaveDialog(window, {
    ...options,
    defaultPath: initialPath(options.defaultPath),
  });
  if (!result.canceled && result.filePath) remember(path.dirname(result.filePath));
  return result;
}
