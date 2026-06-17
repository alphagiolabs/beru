import path from "path";
import fs from "fs";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import { isDev } from "../shared-state.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function getPythonPath() {
  if (isDev) return path.join(__dirname, "..", "..", "python", "processor.py");
  return path.join(process.resourcesPath, "python", "processor.py");
}

/**
 * Look up a binary by name on the system PATH.
 * Returns the resolved absolute path or null.
 */
function _whichOnPath(binName) {
  if (process.platform === "win32") {
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
    } catch {
      // `where` not found or binary not on PATH — expected on many installs.
    }
    return null;
  }

  for (const candidate of [`/usr/bin/${binName}`, `/usr/local/bin/${binName}`]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  try {
    const output = execFileSync("which", [binName], {
      encoding: "utf-8",
      timeout: 5000,
    });
    const resolved = String(output || "").trim();
    if (resolved && fs.existsSync(resolved)) return resolved;
  } catch {
    // Not on PATH.
  }
  return null;
}

const _exe = process.platform === "win32" ? ".exe" : "";

export function getFfprobePath() {
  const devBin = path.join(__dirname, "..", "..", "bin", `ffprobe${_exe}`);
  if (fs.existsSync(devBin)) return devBin;
  const packaged = path.join(process.resourcesPath, "bin", `ffprobe${_exe}`);
  if (!isDev && fs.existsSync(packaged)) return packaged;
  return _whichOnPath("ffprobe") || null;
}

export function getFfmpegPath() {
  const devBin = path.join(__dirname, "..", "..", "bin", `ffmpeg${_exe}`);
  if (fs.existsSync(devBin)) return devBin;
  const packaged = path.join(process.resourcesPath, "bin", `ffmpeg${_exe}`);
  if (!isDev && fs.existsSync(packaged)) return packaged;
  return _whichOnPath("ffmpeg") || null;
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
