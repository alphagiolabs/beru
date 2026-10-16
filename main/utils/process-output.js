import fs from "fs";
import path from "path";
import { OUTPUT_VIDEO_EXTENSIONS } from "../../shared/video-extensions.js";
import { invalidateBeruStatCache } from "./beru-protocol.js";
import { jobMediaSources } from "../../shared/job-manifest.js";
const CONTROL_CHARACTERS = /[\x00-\x1f\x7f]/;
const EXPORT_DIR_PREFIX = ".beru-export-";
const TRANSIENT_RENAME_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);
const RENAME_RETRY_WAITS_MS = [20, 40, 80, 160, 300];

function renameWithRetry(from, to) {
  const pause = new Int32Array(new SharedArrayBuffer(4));
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (err) {
      const wait = RENAME_RETRY_WAITS_MS[attempt];
      if (!TRANSIENT_RENAME_CODES.has(err.code) || wait === undefined) throw err;
      Atomics.wait(pause, 0, 0, wait);
    }
  }
}
const EXPORT_OWNER_FILE = "owner.json";
const EXPORT_ORPHAN_AGE_MS = 24 * 60 * 60 * 1000;

export function sweepOrphanedExports(outputRoot) {
  try {
    const root = fs.realpathSync(outputRoot);
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith(EXPORT_DIR_PREFIX)) continue;
      const dir = path.resolve(root, entry.name);
      if (!isPathInsideRoot(dir, root)) continue;
      try {
        const ownerPath = path.join(dir, EXPORT_OWNER_FILE);
        if (!fs.lstatSync(ownerPath).isFile()) continue;
        const owner = JSON.parse(fs.readFileSync(ownerPath, "utf8"));
        if (
          owner.type !== "beru-export-staging" ||
          !Number.isSafeInteger(owner.pid) ||
          owner.pid <= 0 ||
          !Number.isFinite(owner.createdAt) ||
          Date.now() - owner.createdAt < EXPORT_ORPHAN_AGE_MS ||
          owner.recoverable === true
        )
          continue;
        try {
          process.kill(owner.pid, 0);
          continue;
        } catch (err) {
          if (err.code !== "ESRCH") continue;
        }
        const files = fs.readdirSync(dir, { withFileTypes: true });
        if (
          files.some(
            (file) =>
              !file.isFile() ||
              (file.name !== EXPORT_OWNER_FILE &&
                !/^\d+\.(mp4|mov|mkv|avi|webm)$/i.test(file.name)),
          )
        )
          continue;
        for (const file of files) fs.unlinkSync(path.join(dir, file.name));
        fs.rmdirSync(dir);
      } catch {}
    }
  } catch {}
}

function isPathInsideRoot(candidatePath, rootPath) {
  const root = path.resolve(rootPath);
  const resolved = path.resolve(candidatePath);
  const relative = path.relative(root, resolved);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function promoteWithoutOverwrite(staged, destination) {
  try {
    fs.linkSync(staged, destination);
  } catch (err) {
    if (err.code === "EEXIST") throw err;
    await fs.promises.copyFile(staged, destination, fs.constants.COPYFILE_EXCL);
  }
  try {
    fs.unlinkSync(staged);
  } catch {}
}

export function deriveOutputPath(selectedDirectory, rendererOutputPath, { frame = false } = {}) {
  if (typeof selectedDirectory !== "string" || !selectedDirectory.trim()) {
    throw new Error("No hay una carpeta de salida seleccionada");
  }
  if (typeof rendererOutputPath !== "string" || !rendererOutputPath.trim()) {
    throw new Error("Ruta de salida inválida");
  }
  if (CONTROL_CHARACTERS.test(rendererOutputPath)) {
    throw new Error("Ruta de salida contiene caracteres no permitidos");
  }

  const pathSegments = rendererOutputPath.split(/[\\/]+/);
  if (pathSegments.includes("..")) {
    throw new Error("Path traversal no permitido en la salida");
  }

  const filename = pathSegments.at(-1);
  const extension = path.extname(filename).toLowerCase();
  if (
    !filename ||
    filename === "." ||
    !(OUTPUT_VIDEO_EXTENSIONS.has(extension) || (frame && extension === ".png"))
  ) {
    throw new Error(`Extensión de salida no permitida: ${extension || "(sin extensión)"}`);
  }

  const root = path.resolve(selectedDirectory);
  const outputPath = path.resolve(root, filename);
  if (!isPathInsideRoot(outputPath, root)) {
    throw new Error("La salida está fuera de la carpeta seleccionada");
  }
  return outputPath;
}

async function canonicalPathKey(filePath, realpath) {
  const resolved = path.resolve(filePath);
  let canonical = resolved;
  try {
    canonical = await realpath(resolved);
  } catch {
    try {
      canonical = path.join(await realpath(path.dirname(resolved)), path.basename(resolved));
    } catch {}
  }
  return canonical.toLowerCase();
}

export async function validateBatchOutputPaths(jobs) {
  const resolvedPaths = new Map();
  const realpath = (filePath) => {
    if (!resolvedPaths.has(filePath)) resolvedPaths.set(filePath, fs.promises.realpath(filePath));
    return resolvedPaths.get(filePath);
  };
  const inputPaths = new Set();
  for (const job of jobs) {
    for (const source of jobMediaSources(job)) if (source.path) inputPaths.add(source.path);
  }
  const paths = new Set(inputPaths);
  for (const job of jobs) {
    if (job.output_path) paths.add(job.output_path);
  }
  const keys = new Map();
  const uniquePaths = [...paths];
  for (let i = 0; i < uniquePaths.length; i += 8) {
    await Promise.all(
      uniquePaths.slice(i, i + 8).map(async (filePath) => {
        keys.set(filePath, await canonicalPathKey(filePath, realpath));
      }),
    );
  }
  const inputs = new Set([...inputPaths].map((filePath) => keys.get(filePath)));
  const outputs = new Set();
  for (const job of jobs) {
    if (!job.output_path) continue;
    const key = keys.get(job.output_path);
    if (inputs.has(key)) throw new Error("La salida coincide con una entrada del lote");
    if (outputs.has(key)) throw new Error("Dos videos comparten la misma ruta de salida");
    outputs.add(key);
  }
}

export async function findExistingOutputs(jobs) {
  const existing = await Promise.all(
    jobs.map((job) =>
      fs.promises.lstat(job.output_path).then(
        () => job.output_path,
        () => null,
      ),
    ),
  );
  return existing.filter(Boolean);
}

export function createRunOutputFiles(jobs, outputRoot, { overwrite = false } = {}) {
  const targets = jobs.map((job, index) => {
    const outputPath = deriveOutputPath(outputRoot, job.output_path, {
      frame: job.kind === "composition" && job.frame != null,
    });
    return { key: Number.isInteger(job.id) ? job.id : index, outputPath };
  });
  if (new Set(targets.map((job) => job.key)).size !== targets.length) {
    throw new Error("Dos trabajos comparten el mismo identificador");
  }
  const root = path.resolve(outputRoot);
  const dir = fs.mkdtempSync(path.join(root, EXPORT_DIR_PREFIX));
  const ownerPath = path.join(dir, EXPORT_OWNER_FILE);
  const owner = { type: "beru-export-staging", pid: process.pid, createdAt: Date.now() };
  fs.writeFileSync(ownerPath, JSON.stringify(owner), { flag: "wx" });
  const stagedJobs = jobs.map((job, index) => ({
    ...job,
    output_path: path.join(dir, `${index}${path.extname(targets[index].outputPath)}`),
    output_root: dir,
  }));
  const reserved = new Set(targets.map((job) => job.outputPath.toLowerCase()));
  const promoteToFreePath = async (staged, target) => {
    const { dir: targetDir, name, ext } = path.parse(target);
    for (let n = 1; ; n++) {
      const candidate = n === 1 ? target : path.join(targetDir, `${name}__${n}${ext}`);
      if (n > 1 && reserved.has(candidate.toLowerCase())) continue;
      try {
        await promoteWithoutOverwrite(staged, candidate);
        return candidate;
      } catch (err) {
        if (err.code !== "EEXIST") throw err;
      }
    }
  };
  const completed = new Map();
  const preserved = new Set();
  return {
    jobs: stagedJobs,
    async complete(index) {
      const position = targets.findIndex((job) => job.key === index);
      if (position < 0) throw new Error("El procesador devolvió un trabajo desconocido");
      if (!completed.has(index)) {
        const staged = stagedJobs[position].output_path;
        const target = targets[position].outputPath;
        const stat = fs.statSync(staged);
        if (!stat.isFile() || stat.size === 0) {
          throw new Error("FFmpeg no produjo un archivo de salida válido");
        }
        let destination = target;
        try {
          let replaced = false;
          if (overwrite) {
            try {
              renameWithRetry(staged, target);
              replaced = true;
            } catch {}
          }
          if (!replaced) destination = await promoteToFreePath(staged, target);
        } catch (err) {
          preserved.add(staged);
          try {
            fs.writeFileSync(ownerPath, JSON.stringify({ ...owner, recoverable: true }));
          } catch {
            try {
              fs.unlinkSync(ownerPath);
            } catch {}
          }
          throw new Error(`${err.message}. El video exportado se conservó en ${staged}`);
        }
        invalidateBeruStatCache(destination);
        completed.set(index, destination);
      }
      return completed.get(index);
    },
    dispose() {
      for (const job of stagedJobs) {
        if (preserved.has(job.output_path)) continue;
        removeIncompleteOutput(job.output_path, { outputRoot: dir, inputPath: job.input_path });
      }
      if (preserved.size > 0) return;
      try {
        fs.unlinkSync(ownerPath);
        fs.rmdirSync(dir);
      } catch {}
    },
  };
}

export function removeIncompleteOutput(outputPath, { outputRoot, inputPath } = {}) {
  try {
    if (typeof outputPath !== "string" || !outputPath.trim()) return false;
    if (typeof outputRoot !== "string" || !outputRoot.trim()) return false;

    const resolved = path.resolve(outputPath);
    if (!isPathInsideRoot(resolved, outputRoot)) return false;

    if (typeof inputPath === "string" && inputPath.trim()) {
      if (resolved === path.resolve(inputPath)) return false;
    }

    if (!fs.existsSync(resolved)) return false;
    const st = fs.statSync(resolved);
    if (!st.isFile()) return false;
    fs.unlinkSync(resolved);
    return true;
  } catch (err) {
    console.error("[beru] removeIncompleteOutput failed:", err?.message || err);
    return false;
  }
}
