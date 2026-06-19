import path from "path";

const OUTPUT_EXTENSIONS = new Set([".mp4", ".mov", ".mkv", ".avi", ".webm"]);
const CONTROL_CHARACTERS = /[\x00-\x1f\x7f]/;

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
  if (!filename || filename === "." || !OUTPUT_EXTENSIONS.has(extension)) {
    throw new Error(`Extensión de salida no permitida: ${extension || "(sin extensión)"}`);
  }

  const root = path.resolve(selectedDirectory);
  const outputPath = path.resolve(root, filename);
  const relative = path.relative(root, outputPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("La salida está fuera de la carpeta seleccionada");
  }
  return outputPath;
}
