import path from "path";
import fs from "fs";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import { isDev } from "../shared-state.js";
import { app } from "electron";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function getThumbnailCacheDirectory() {
  return path.join(app.getPath("userData"), "cache", "thumbnails-v1");
}

export function getPythonPath() {
  return path.join(__dirname, "..", "..", "python", "processor.py");
}

function _whichOnPath(binName) {
  try {
    const output = execFileSync("where", [binName], {
      windowsHide: true,
      encoding: "utf-8",
      timeout: 5000,
    });
    const first = String(output || "")
      .trim()
      .split(/\r?\n/)[0];
    if (first && fs.existsSync(first)) return first;
  } catch {}
  return null;
}

function resolveBinary(name) {
  const devBin = path.join(__dirname, "..", "..", "bin", `${name}.exe`);
  if (fs.existsSync(devBin)) return devBin;
  const packaged = path.join(process.resourcesPath, "bin", `${name}.exe`);
  if (!isDev && fs.existsSync(packaged)) return packaged;
  return _whichOnPath(name) || null;
}

export function getFfprobePath() {
  return resolveBinary("ffprobe");
}

export function getFfmpegPath() {
  return resolveBinary("ffmpeg");
}

/**
 * @returns {{ ok: true, ffmpegPath: string, ffprobePath: string } | { ok: false, error: string }}
 */
export function validateMediaBinaries() {
  const reinstallHint = isDev
    ? "Ejecute «npm install» en la carpeta del proyecto para descargar los binarios incluidos."
    : "Reinstale Beru desde el instalador oficial.";

  const ffmpegPath = getFfmpegPath();
  if (!ffmpegPath || !fs.existsSync(ffmpegPath)) {
    return {
      ok: false,
      error: `No se encontró FFmpeg. ${reinstallHint}`,
    };
  }
  const ffprobePath = getFfprobePath();
  if (!ffprobePath || !fs.existsSync(ffprobePath)) {
    return {
      ok: false,
      error: `No se encontró ffprobe. ${reinstallHint}`,
    };
  }
  return { ok: true, ffmpegPath, ffprobePath };
}
