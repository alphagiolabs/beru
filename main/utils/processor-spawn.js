import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { isDev } from "../shared-state.js";
import { getPythonPath } from "./paths.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const _exe = process.platform === "win32" ? ".exe" : "";
const PROCESSOR_NAME = `beru-processor${_exe}`;

let systemPythonCache = { resolved: false, value: null };
let bundledProcessorCache = { resolved: false, value: null };
let systemPythonPromise = null;

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

function getPythonCandidates() {
  return process.platform === "win32" ? WINDOWS_CANDIDATES : UNIX_CANDIDATES;
}

function getConfiguredPython() {
  const command = process.env.BERU_PYTHON;
  return command && fs.existsSync(command) ? { command, args: [] } : null;
}

function probePythonCandidateAsync(candidate) {
  return new Promise((resolve, reject) => {
    const proc = spawn(candidate.command, [...candidate.args, "--version"], {
      windowsHide: true,
      stdio: "ignore",
    });
    let settled = false;
    let timeout;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(candidate);
    };
    proc.once("error", finish);
    proc.once("close", (code) =>
      finish(code === 0 ? null : new Error(`${candidate.command} exited with code ${code}`)),
    );
    timeout = setTimeout(() => {
      try {
        proc.kill();
      } catch {}
      finish(new Error(`${candidate.command} probe timed out`));
    }, 5000);
  });
}

async function resolveSystemPythonSpawnAsync() {
  if (systemPythonCache.resolved) return systemPythonCache.value;
  if (systemPythonPromise) return systemPythonPromise;
  systemPythonPromise = (async () => {
    let value = getConfiguredPython();
    if (!value) {
      for (const candidate of getPythonCandidates()) {
        try {
          value = await probePythonCandidateAsync(candidate);
          break;
        } catch {}
      }
    }
    systemPythonCache = { resolved: true, value };
    systemPythonPromise = null;
    return value;
  })();
  return systemPythonPromise;
}

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
