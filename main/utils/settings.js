import { app } from "electron";
import path from "path";
import fs from "fs";
import { spawnSync } from "child_process";
import { getFfmpegPath } from "./paths.js";
import { pickHwEncoderFromEncodersText } from "../workerPolicy.js";

export const ALLOWED_SETTINGS_KEYS = new Set([
  "theme",
  "language",
  "encodeProfile",
  "batchWorkers",
  "batchWorkersMode",
  "batchRetryFailed",
]);

export const SETTINGS_DEFAULTS = {
  theme: "dark",
  language: "es",
  encodeProfile: "balanced",
  batchWorkers: 0,
  batchWorkersMode: "balanced",
  batchRetryFailed: true,
};

let cachedHwEncoder = null;

export function readSettings() {
  try {
    const file = path.join(app.getPath("userData"), "settings.json");
    if (!fs.existsSync(file)) return { ...SETTINGS_DEFAULTS };
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw);
    return { ...SETTINGS_DEFAULTS, ...parsed };
  } catch {
    return { ...SETTINGS_DEFAULTS };
  }
}

export function writeSettings(obj) {
  const file = path.join(app.getPath("userData"), "settings.json");
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), "utf8");
}

export async function detectHwEncoderCached() {
  if (cachedHwEncoder !== null) return cachedHwEncoder || null;
  const ffmpeg = getFfmpegPath();
  try {
    const r = spawnSync(ffmpeg, ["-hide_banner", "-encoders"], {
      encoding: "utf8",
      timeout: 15000,
      windowsHide: true,
    });
    const text = `${r.stdout || ""}${r.stderr || ""}`;
    cachedHwEncoder = pickHwEncoderFromEncodersText(text) || "";
  } catch {
    cachedHwEncoder = "";
  }
  return cachedHwEncoder || null;
}
