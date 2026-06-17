import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { isDev } from "../shared-state.js";
import { getPythonPath } from "./paths.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const _exe = process.platform === "win32" ? ".exe" : "";
const PROCESSOR_NAME = `beru-processor${_exe}`;

const WINDOWS_CANDIDATES = [
  { command: "py", args: ["-3"] },
  { command: "python", args: [] },
  { command: "python3", args: [] },
];

const UNIX_CANDIDATES = [
  { command: "python3", args: [] },
  { command: "python", args: [] },
];

function probePythonCandidate(candidate) {
  execFileSync(candidate.command, [...candidate.args, "--version"], {
    windowsHide: true,
    timeout: 5000,
    stdio: "pipe",
  });
  return candidate;
}

function resolveSystemPythonSpawn() {
  if (process.env.BERU_PYTHON && fs.existsSync(process.env.BERU_PYTHON)) {
    return { command: process.env.BERU_PYTHON, args: [] };
  }
  const candidates = process.platform === "win32" ? WINDOWS_CANDIDATES : UNIX_CANDIDATES;
  for (const candidate of candidates) {
    try {
      return probePythonCandidate(candidate);
    } catch {
      // Not available — try next candidate.
    }
  }
  return null;
}

/** Absolute path to the PyInstaller-built processor binary, if present. */
export function getBundledProcessorPath() {
  const devBin = path.join(__dirname, "..", "..", "bin", PROCESSOR_NAME);
  if (fs.existsSync(devBin)) return devBin;
  if (!isDev && process.resourcesPath) {
    const packaged = path.join(process.resourcesPath, "bin", PROCESSOR_NAME);
    if (fs.existsSync(packaged)) return packaged;
  }
  return null;
}

/**
 * Build spawn args for processor.py or beru-processor.exe.
 * @param {string[]} userArgs e.g. [tmpFile] or ["--preview-frame-worker"]
 * @returns {{ command: string, args: string[], mode: "bundled" | "script" } | null}
 */
export function resolveProcessorSpawn(userArgs = []) {
  const bundled = getBundledProcessorPath();
  const preferBundled =
    bundled && (!isDev || process.env.BERU_USE_BUNDLED === "1" || !resolveSystemPythonSpawn());

  if (preferBundled) {
    return { command: bundled, args: userArgs, mode: "bundled" };
  }

  const py = resolveSystemPythonSpawn();
  if (!py) return null;

  const scriptPath = getPythonPath();
  if (!fs.existsSync(scriptPath)) return null;

  return {
    command: py.command,
    args: [...py.args, scriptPath, ...userArgs],
    mode: "script",
  };
}

/**
 * @returns {{ ok: true, command: string, args: string[], mode: "bundled" | "script" } | { ok: false, error: string }}
 */
export function validateProcessorAvailable() {
  if (!isDev) {
    const bundled = getBundledProcessorPath();
    if (!bundled) {
      return {
        ok: false,
        error:
          "No se encontró el motor de procesamiento incluido en la instalación. " +
          "Reinstale Beru desde el instalador oficial.",
      };
    }
    return { ok: true, command: bundled, args: [], mode: "bundled" };
  }

  const resolved = resolveProcessorSpawn([]);
  if (!resolved) {
    return {
      ok: false,
      error:
        "Python 3 no está instalado o no se encontró processor.py. " +
        "Instálelo desde https://www.python.org/downloads/ (marque 'Add to PATH') " +
        "o ejecute «npm run build:processor» para generar el binario incluido.",
    };
  }
  return { ok: true, ...resolved };
}

/** @deprecated Use validateProcessorAvailable — kept for existing tests. */
export function resolvePythonSpawn() {
  return resolveSystemPythonSpawn();
}

/** @deprecated Use validateProcessorAvailable — kept for existing tests. */
export function validatePythonAvailable() {
  const check = validateProcessorAvailable();
  if (!check.ok) return check;
  if (check.mode === "bundled") {
    return { ok: true, command: check.command, args: [] };
  }
  const py = resolveSystemPythonSpawn();
  return py ? { ok: true, ...py } : { ok: false, error: check.error || "Python no disponible" };
}

export function getEncodeProfilesPath() {
  if (!isDev && process.resourcesPath) {
    const packaged = path.join(process.resourcesPath, "encode-profiles.json");
    if (fs.existsSync(packaged)) return packaged;
  }
  const devPath = path.join(__dirname, "..", "..", "resources", "encode-profiles.json");
  if (fs.existsSync(devPath)) return devPath;
  return null;
}

export function buildProcessorChildEnv(baseEnv, { ffmpegPath, ffprobePath } = {}) {
  const childEnv = {
    ...baseEnv,
    PYTHONIOENCODING: "utf-8",
    PYTHONUTF8: "1",
  };
  if (ffmpegPath) childEnv.BERU_FFMPEG = ffmpegPath;
  if (ffprobePath) childEnv.BERU_FFPROBE = ffprobePath;
  const profilesPath = getEncodeProfilesPath();
  if (profilesPath) childEnv.BERU_ENCODE_PROFILES = profilesPath;
  return childEnv;
}
