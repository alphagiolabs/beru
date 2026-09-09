import { app } from "electron";
import path from "path";
import fs from "fs";
import { spawn } from "child_process";
import { writeJsonAtomic } from "./atomic-json.js";
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
let hwEncoderPromise = null;

let settingsCache = null;

function settingsCacheEnabled() {
  return process.env.BERU_SETTINGS_CACHE === "1";
}

export function readSettings() {
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
  writeJsonAtomic(file, obj);
  if (settingsCacheEnabled()) settingsCache = { ...obj };
}

function readFfmpegEncoders(ffmpeg) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpeg, ["-hide_banner", "-encoders"], { windowsHide: true });
    let output = "";
    let settled = false;
    let timeout;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(output);
    };
    const append = (chunk) => {
      output += chunk.toString();
    };
    proc.stdout.on("data", append);
    proc.stderr.on("data", append);
    proc.once("error", finish);
    proc.once("close", () => finish());
    timeout = setTimeout(() => {
      try {
        proc.kill();
      } catch {}
      finish(new Error("FFmpeg encoder detection timed out"));
    }, 15000);
  });
}

async function detectHwEncoder() {
  try {
    const text = await readFfmpegEncoders(getFfmpegPath());
    return pickHwEncoderFromEncodersText(text) || "";
  } catch {
    return "";
  }
}

export async function detectHwEncoderCached() {
  if (cachedHwEncoder !== null) return cachedHwEncoder || null;
  if (!hwEncoderPromise) hwEncoderPromise = detectHwEncoder();
  try {
    cachedHwEncoder = await hwEncoderPromise;
    return cachedHwEncoder || null;
  } finally {
    hwEncoderPromise = null;
  }
}
