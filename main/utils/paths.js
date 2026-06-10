import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { isDev } from "../shared-state.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function getPythonPath() {
  if (isDev) return path.join(__dirname, "..", "..", "python", "processor.py");
  return path.join(process.resourcesPath, "python", "processor.py");
}

export function getFfprobePath() {
  const devBin = path.join(__dirname, "..", "..", "bin", "ffprobe.exe");
  const packaged = path.join(process.resourcesPath, "bin", "ffprobe.exe");
  if (fs.existsSync(devBin)) return devBin;
  if (!isDev && fs.existsSync(packaged)) return packaged;
  return null;
}

export function getFfmpegPath() {
  const devBin = path.join(__dirname, "..", "..", "bin", "ffmpeg.exe");
  const packaged = path.join(process.resourcesPath, "bin", "ffmpeg.exe");
  if (fs.existsSync(devBin)) return devBin;
  if (!isDev && fs.existsSync(packaged)) return packaged;
  return null;
}
