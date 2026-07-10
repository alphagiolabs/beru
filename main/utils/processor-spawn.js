import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { isDev } from "../shared-state.js";
import { getPythonPath } from "./paths.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const _exe = process.platform === "win32" ? ".exe" : "";
const PROCESSOR_NAME = `beru-processor${_exe}`;

// --- Spawn resolution cache (opt-in) ----------------------------------------
// resolveProcessorSpawn() re-probes Python via execFileSync(..., "--version")
// on every call, and getBundledProcessorPath() does fs.existsSync checks each
// time. Both results are stable for the process lifetime, so memoize them.
// Enable with BERU_PROCESSOR_SPAWN_CACHE=1. Default off = current behavior.
let systemPythonCache = { resolved: false, value: null };
let bundledProcessorCache = { resolved: false, value: null };

function processorSpawnCacheEnabled() {
  return process.env.BERU_PROCESSOR_SPAWN_CACHE === "1";
}

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
  if (processorSpawnCacheEnabled() && systemPythonCache.resolved) {
    return systemPythonCache.value;
  }
  let value;
  if (process.env.BERU_PYTHON && fs.existsSync(process.env.BERU_PYTHON)) {
    value = { command: process.env.BERU_PYTHON, args: [] };
  } else {
    const candidates = process.platform === "win32" ? WINDOWS_CANDIDATES : UNIX_CANDIDATES;
    value = null;
    for (const candidate of candidates) {
      try {
        value = probePythonCandidate(candidate);
        break;
      } catch {
        // Not available — try next candidate.
      }
    }
  }
  if (processorSpawnCacheEnabled()) systemPythonCache = { resolved: true, value };
  return value;
}

/** Absolute path to the PyInstaller-built processor binary, if present. */
export function getBundledProcessorPath() {
  if (processorSpawnCacheEnabled() && bundledProcessorCache.resolved) {
    return bundledProcessorCache.value;
  }
  const devBin = path.join(__dirname, "..", "..", "bin", PROCESSOR_NAME);
  let value = null;
  if (fs.existsSync(devBin)) {
    value = devBin;
  } else if (!isDev && process.resourcesPath) {
    const packaged = path.join(process.resourcesPath, "bin", PROCESSOR_NAME);
    if (fs.existsSync(packaged)) value = packaged;
  }
  if (processorSpawnCacheEnabled()) bundledProcessorCache = { resolved: true, value };
  return value;
}

/**
 * Build spawn args for processor.py or beru-processor.exe.
 * @param {string[]} userArgs e.g. [tmpFile] or ["--preview-frame-worker"]
 * @returns {{ command: string, args: string[], mode: "bundled" | "script" } | null}
 */
export function resolveProcessorSpawn(userArgs = []) {
  const bundled = getBundledProcessorPath();

  // Packaged installs ship only the PyInstaller binary under resources/bin.
  // Never fall back to loose processor.py (those scripts are not packaged).
  if (!isDev) {
    if (!bundled) return null;
    return { command: bundled, args: userArgs, mode: "bundled" };
  }

  const preferBundled =
    bundled && (process.env.BERU_USE_BUNDLED === "1" || !resolveSystemPythonSpawn());

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

function getEncodeProfilesPath() {
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
