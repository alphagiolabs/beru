import { app } from "electron";
import path from "path";
import fs from "fs";
import { writeJsonAtomic } from "./atomic-json.js";
import { getFfmpegPath } from "./paths.js";
import { runCapturedProcess } from "./run-captured.js";
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
  petMovement: "fixed",
};

let cachedHwEncoder = null;
let hwEncoderPromise = null;

const MAX_ENCODER_LIST_BYTES = 1024 * 1024;

export function readSettings() {
  try {
    const file = path.join(app.getPath("userData"), "settings.json");
    if (!fs.existsSync(file)) return { ...SETTINGS_DEFAULTS };
    const raw = fs.readFileSync(file, "utf8");
    return { ...SETTINGS_DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...SETTINGS_DEFAULTS };
  }
}

export function writeSettings(obj) {
  const file = path.join(app.getPath("userData"), "settings.json");
  writeJsonAtomic(file, obj);
}

async function readFfmpegEncoders(ffmpeg) {
  const result = await runCapturedProcess(ffmpeg, ["-hide_banner", "-encoders"], {
    timeoutMs: 15000,
    maxStdoutBytes: MAX_ENCODER_LIST_BYTES,
    maxStderrBytes: MAX_ENCODER_LIST_BYTES,
    truncateOnLimit: true,
  });
  if (result.error) throw result.error;
  if (result.timedOut) throw new Error("FFmpeg encoder detection timed out");
  return `${result.stdout}${result.stderr}`;
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
