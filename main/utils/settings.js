import { app } from "electron";
import path from "path";
import fs from "fs";
import { spawnSync } from "child_process";
import { getFfmpegPath } from "./paths.js";
import { pickHwEncoderFromEncodersText } from "../workerPolicy.js";

export const ALLOWED_SETTINGS_KEYS = new Set([
  "theme",
  "themeActiveSlot",
  "themeSlot1",
  "themeSlot2",
  "customThemes",
  "language",
  "encodeProfile",
  "batchWorkers",
  "batchWorkersMode",
  "batchRetryFailed",
  "petEnabled",
  "petActiveSlug",
  "petPosition",
  "petPopoutPosition",
  "petPoppedOut",
  "petScale",
  "petOpacity",
  "petMovement",
]);

const SETTINGS_DEFAULTS = {
  theme: "dark",
  themeActiveSlot: 2,
  themeSlot1: "beru-light",
  themeSlot2: "beru-dark",
  customThemes: [],
  language: "es",
  encodeProfile: "balanced",
  batchWorkers: 0,
  batchWorkersMode: "balanced",
  batchRetryFailed: true,
  petEnabled: false,
  petActiveSlug: null,
  petPosition: null,
  petPopoutPosition: null,
  petPoppedOut: false,
  petScale: 0.33,
  petOpacity: 1.0,
  petMovement: "fijo",
};

let cachedHwEncoder = null;

// --- Settings cache (opt-in) ------------------------------------------------
// readSettings() is called on many IPC handlers; each call does
// existsSync + readFileSync + JSON.parse on the main thread. The cache holds
// the parsed object in memory and is invalidated on writeSettings.
// Enable with BERU_SETTINGS_CACHE=1. Default off = current behavior.
let settingsCache = null;

function settingsCacheEnabled() {
  return process.env.BERU_SETTINGS_CACHE === "1";
}

export function readSettings() {
  // Always return a shallow copy so callers cannot mutate the cached object.
  if (settingsCacheEnabled() && settingsCache) return { ...settingsCache };
  let parsed;
  try {
    const file = path.join(app.getPath("userData"), "settings.json");
    if (!fs.existsSync(file)) {
      parsed = { ...SETTINGS_DEFAULTS };
    } else {
      const raw = fs.readFileSync(file, "utf8");
      parsed = { ...SETTINGS_DEFAULTS, ...JSON.parse(raw) };
    }
  } catch {
    parsed = { ...SETTINGS_DEFAULTS };
  }
  if (settingsCacheEnabled()) settingsCache = parsed;
  return parsed;
}

export function writeSettings(obj) {
  const file = path.join(app.getPath("userData"), "settings.json");
  // Atomic write: write to a sibling temp file then rename. A crash or power
  // loss mid-write otherwise leaves a truncated settings.json, silently
  // resetting the user to defaults on next read.
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), "utf8");
  fs.renameSync(tmp, file);
  // Store a copy so external mutations after write do not corrupt the cache.
  if (settingsCacheEnabled()) settingsCache = { ...obj };
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
