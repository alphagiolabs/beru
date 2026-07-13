import fs from "fs";
import path from "path";
import { OUTPUT_VIDEO_EXTENSIONS } from "../../shared/video-extensions.js";
const CONTROL_CHARACTERS = /[\x00-\x1f\x7f]/;

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

/**
 * Best-effort unlink of a partial cancel leftover. Never throws.
 * Refuses paths outside outputRoot, the output root itself, and inputPath.
 */
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
