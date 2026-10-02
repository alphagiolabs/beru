import fs from "fs";
import path from "path";

const EXT_BY_KIND = {
  excel: new Set([".xlsx", ".xls", ".xlsm"]),
  image: new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"]),
  video: new Set([
    ".mp4",
    ".mov",
    ".avi",
    ".mkv",
    ".webm",
    ".flv",
    ".wmv",
    ".m4v",
    ".mpg",
    ".mpeg",
  ]),
  project: new Set([".json", ".beru.json"]),
};

const MAX_BYTES_BY_KIND = {
  excel: 25 * 1024 * 1024,
  image: 15 * 1024 * 1024,
  video: 8 * 1024 * 1024 * 1024,
  project: 8 * 1024 * 1024,
};

export function createPathVerdicts({
  resolveSafe,
  location,
  consent,
  statSync = fs.statSync,
  warn = console.warn,
}) {
  const canRead = (resolved) => consent.hasReadConsent(resolved) || location.isUnderRoot(resolved);

  function inspectReadableFile(filePath, kind, { selectedByUser = false } = {}) {
    const resolved = resolveSafe(filePath);
    if (!resolved) {
      return { ok: false, error: "Ruta inválida" };
    }
    if (location.isDenied(resolved)) {
      warn("[beru][security] Denied read:", resolved);
      return { ok: false, error: "Ruta no permitida" };
    }

    let stat;
    try {
      stat = statSync(resolved);
    } catch {
      return { ok: false, error: "Archivo no encontrado" };
    }
    if (!stat.isFile()) {
      return { ok: false, error: "La ruta no es un archivo" };
    }

    const ext = path.extname(resolved).toLowerCase();
    const allowedExt = EXT_BY_KIND[kind];
    if (!allowedExt?.has(ext)) {
      return { ok: false, error: `Extensión no permitida: ${ext || "(sin extensión)"}` };
    }

    if (!selectedByUser && !canRead(resolved)) {
      warn("[beru][security] Path outside trusted roots:", resolved);
      return { ok: false, error: "Archivo fuera de ubicaciones permitidas" };
    }

    const maxBytes = MAX_BYTES_BY_KIND[kind];
    if (stat.size > maxBytes) {
      return { ok: false, error: "Archivo demasiado grande" };
    }

    return { ok: true, resolvedPath: resolved };
  }

  function inspectShellPath(targetPath) {
    const resolved = resolveSafe(targetPath);
    if (!resolved) return { ok: false, error: "Ruta inválida" };
    if (location.isDenied(resolved)) {
      return { ok: false, error: "Ruta no permitida" };
    }
    if (!canRead(resolved)) {
      return { ok: false, error: "Ruta fuera de ubicaciones permitidas" };
    }
    let stat;
    try {
      stat = statSync(resolved);
    } catch {
      return { ok: false, error: "Archivo no encontrado" };
    }
    if (!stat.isFile() && !stat.isDirectory()) {
      return { ok: false, error: "Ruta no permitida" };
    }
    return { ok: true, resolvedPath: resolved };
  }

  function inspectOutputDirectory(directoryPath) {
    const resolved = resolveSafe(directoryPath);
    if (!resolved || location.isDenied(resolved)) {
      return { ok: false, error: "Carpeta de salida no permitida" };
    }
    try {
      if (!statSync(resolved).isDirectory()) {
        return { ok: false, error: "La salida debe ser una carpeta" };
      }
    } catch {
      return { ok: false, error: "Carpeta de salida no encontrada" };
    }
    return { ok: true, resolvedPath: resolved };
  }

  function inspectProtocolFile(filePath) {
    const ext = path.extname(filePath || "").toLowerCase();
    const kind = EXT_BY_KIND.image.has(ext) ? "image" : "video";
    return inspectReadableFile(filePath, kind);
  }

  return {
    inspectReadableFile,
    inspectShellPath,
    inspectOutputDirectory,
    inspectProtocolFile,
  };
}
