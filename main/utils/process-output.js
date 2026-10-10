import fs from "fs";
import path from "path";
import { OUTPUT_VIDEO_EXTENSIONS } from "../../shared/video-extensions.js";
import { invalidateBeruStatCache } from "./beru-protocol.js";
const CONTROL_CHARACTERS = /[\x00-\x1f\x7f]/;
const EXPORT_DIR_PREFIX = ".beru-export-";

function isPathInsideRoot(candidatePath, rootPath) {
  const root = path.resolve(rootPath);
  const resolved = path.resolve(candidatePath);
  const relative = path.relative(root, resolved);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export function deriveOutputPath(selectedDirectory, rendererOutputPath) {
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
  if (!filename || filename === "." || !OUTPUT_VIDEO_EXTENSIONS.has(extension)) {
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
    inputPaths.add(job.input_path);
    for (const op of job.operations || []) {
      for (const imagePath of [op.image_path, op.delogo_image_path]) {
        if (imagePath) inputPaths.add(imagePath);
      }
    }
    const imagePath = job.watermark?.imagePath || job.watermark?.watermark_image;
    if (imagePath) inputPaths.add(imagePath);
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

export function createRunOutputFiles(jobs, outputRoot) {
  const targets = jobs.map((job, index) => {
    const outputPath = deriveOutputPath(outputRoot, job.output_path);
    return { key: Number.isInteger(job.id) ? job.id : index, outputPath };
  });
  if (new Set(targets.map((job) => job.key)).size !== targets.length) {
    throw new Error("Dos trabajos comparten el mismo identificador");
  }
  const root = path.resolve(outputRoot);
  const dir = fs.mkdtempSync(path.join(root, EXPORT_DIR_PREFIX));
  const stagedJobs = jobs.map((job, index) => ({
    ...job,
    output_path: path.join(dir, `${index}${path.extname(targets[index].outputPath)}`),
    output_root: dir,
  }));
  const completed = new Set();
  return {
    jobs: stagedJobs,
    complete(index) {
      const position = targets.findIndex((job) => job.key === index);
      if (position < 0) throw new Error("El procesador devolvió un trabajo desconocido");
      if (!completed.has(index)) {
        const stat = fs.statSync(stagedJobs[position].output_path);
        if (!stat.isFile() || stat.size === 0) {
          throw new Error("FFmpeg no produjo un archivo de salida válido");
        }
        fs.renameSync(stagedJobs[position].output_path, targets[position].outputPath);
        invalidateBeruStatCache(targets[position].outputPath);
        completed.add(index);
      }
      return targets[position].outputPath;
    },
    dispose() {
      for (const job of stagedJobs) {
        removeIncompleteOutput(job.output_path, { outputRoot: dir, inputPath: job.input_path });
      }
      try {
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
