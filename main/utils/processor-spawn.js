import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { isDev } from "../shared-state.js";
import { getPythonPath } from "./paths.js";
import { runCapturedProcess } from "./run-captured.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROCESSOR_NAME = "beru-processor.exe";
const PROCESSOR_SOURCE_DIR = path.join(__dirname, "..", "..", "python");
const IGNORED_SOURCE_DIRS = new Set(["__pycache__", "build", "dist"]);

let systemPythonCache = { resolved: false, value: null };
let systemPythonPromise = null;
let staleProcessorWarned = false;

const WINDOWS_CANDIDATES = [
  { command: "py", args: ["-3"] },
  { command: "python", args: [] },
  { command: "python3", args: [] },
];

function getConfiguredPython() {
  const command = process.env.BERU_PYTHON;
  return command && fs.existsSync(command) ? { command, args: [] } : null;
}

function cachedPythonUsable(value) {
  if (!value) return false;
  const configured = process.env.BERU_PYTHON;
  if (configured && configured !== value.command && fs.existsSync(configured)) return false;
  return !/[\\/]/.test(value.command) || fs.existsSync(value.command);
}

async function probePythonCandidateAsync(candidate) {
  const result = await runCapturedProcess(candidate.command, [...candidate.args, "--version"], {
    timeoutMs: 5000,
    capture: false,
  });
  if (result.error) throw result.error;
  if (result.timedOut) throw new Error(`${candidate.command} probe timed out`);
  if (result.code !== 0) {
    throw new Error(`${candidate.command} exited with code ${result.code}`);
  }
  return candidate;
}

export function invalidateSystemPythonCache() {
  systemPythonCache = { resolved: false, value: null };
}

async function resolveSystemPythonSpawnAsync() {
  if (systemPythonCache.resolved && cachedPythonUsable(systemPythonCache.value)) {
    return systemPythonCache.value;
  }
  if (systemPythonPromise) return systemPythonPromise;
  const promise = (async () => {
    let value = getConfiguredPython();
    if (!value) {
      for (const candidate of WINDOWS_CANDIDATES) {
        try {
          value = await probePythonCandidateAsync(candidate);
          break;
        } catch {}
      }
    }
    systemPythonCache = { resolved: true, value };
    return value;
  })();
  systemPythonPromise = promise;
  try {
    return await promise;
  } finally {
    if (systemPythonPromise === promise) systemPythonPromise = null;
  }
}

function newestMtimeMs(dir) {
  let newest = 0;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_SOURCE_DIRS.has(entry.name)) continue;
      newest = Math.max(newest, newestMtimeMs(full));
      continue;
    }
    if (!entry.name.endsWith(".py") && !entry.name.endsWith(".spec")) continue;
    if (entry.name.startsWith("test_")) continue;
    try {
      newest = Math.max(newest, fs.statSync(full).mtimeMs);
    } catch {}
  }
  return newest;
}

function warnIfProcessorStale(bundledPath) {
  if (!isDev || staleProcessorWarned || !bundledPath) return;
  staleProcessorWarned = true;
  try {
    const sourceMtime = newestMtimeMs(PROCESSOR_SOURCE_DIR);
    if (sourceMtime === 0) return;
    if (fs.statSync(bundledPath).mtimeMs < sourceMtime) {
      console.warn(
        `[beru] El procesador incluido está desactualizado (${path.basename(bundledPath)} es ` +
          `anterior a python/). Las correcciones de python/ no se aplicarán. ` +
          `Ejecute "npm run build:processor".`,
      );
    }
  } catch {}
}

export function getBundledProcessorPath() {
  const devBin = path.join(__dirname, "..", "..", "bin", PROCESSOR_NAME);
  if (fs.existsSync(devBin)) {
    warnIfProcessorStale(devBin);
    return devBin;
  }
  if (!isDev && process.resourcesPath) {
    const packaged = path.join(process.resourcesPath, "bin", PROCESSOR_NAME);
    if (fs.existsSync(packaged)) return packaged;
  }
  return null;
}

function buildProcessorSpawn(bundled, python, userArgs) {
  if (!isDev) {
    return bundled ? { command: bundled, args: userArgs, mode: "bundled" } : null;
  }
  if (bundled && (process.env.BERU_USE_BUNDLED === "1" || !python)) {
    return { command: bundled, args: userArgs, mode: "bundled" };
  }
  if (!python) return null;

  const scriptPath = getPythonPath();
  if (!fs.existsSync(scriptPath)) return null;
  return {
    command: python.command,
    args: [...python.args, scriptPath, ...userArgs],
    mode: "script",
  };
}

export async function resolveProcessorSpawnAsync(userArgs = []) {
  const bundled = getBundledProcessorPath();
  const python =
    isDev && !(bundled && process.env.BERU_USE_BUNDLED === "1")
      ? await resolveSystemPythonSpawnAsync()
      : null;
  return buildProcessorSpawn(bundled, python, userArgs);
}

function processorAvailability(resolved) {
  if (resolved) return { ok: true, ...resolved };
  if (!isDev) {
    return {
      ok: false,
      error:
        "No se encontró el motor de procesamiento incluido en la instalación. " +
        "Reinstale Beru desde el instalador oficial.",
    };
  }
  return {
    ok: false,
    error:
      "Python 3 no está instalado o no se encontró processor.py. " +
      "Instálelo desde https://www.python.org/downloads/ (marque 'Add to PATH') " +
      "o ejecute «npm run build:processor» para generar el binario incluido.",
  };
}

export async function validateProcessorAvailableAsync() {
  return processorAvailability(await resolveProcessorSpawnAsync([]));
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
