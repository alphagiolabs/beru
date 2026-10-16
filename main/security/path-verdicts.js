import fs from "fs";
import path from "path";
import { INPUT_VIDEO_EXTENSIONS } from "../../shared/video-extensions.js";

const EXT_BY_KIND = {
  excel: new Set([".xlsx", ".xls", ".xlsm"]),
  image: new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"]),
  audio: new Set([".wav", ".mp3", ".m4a", ".aac", ".flac", ".ogg", ".opus", ".aiff", ".aif"]),
  video: new Set(INPUT_VIDEO_EXTENSIONS.map((extension) => `.${extension}`)),
  project: new Set([".json", ".beru.json"]),
};

const MAX_BYTES_BY_KIND = {
  excel: 25 * 1024 * 1024,
  image: 15 * 1024 * 1024,
  audio: 1024 * 1024 * 1024,
  video: Number.POSITIVE_INFINITY,
  project: 8 * 1024 * 1024,
};

export function createPathVerdicts({
  resolveSafe,
  resolveSafeAsync,
  location,
  consent,
  statSync = fs.statSync,
  protocolStat = statSync,
  warn = console.warn,
}) {
  const canRead = (resolved) => consent.hasReadConsent(resolved) || location.isUnderRoot(resolved);

  function inspectReadableFile(filePath, kind, { selectedByUser = false, statFn = statSync } = {}) {
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
      stat = statFn(resolved);
    } catch {
      return { ok: false, error: "Archivo no encontrado" };
    }
    const error = inspectFileStat(resolved, kind, stat);
    if (error) return error;
    return finishReadableFile(resolved, kind, stat, selectedByUser || canRead(resolved));
  }

  function inspectFileStat(resolved, kind, stat) {
    if (!stat.isFile()) {
      return { ok: false, error: "La ruta no es un archivo" };
    }

    const ext = path.extname(resolved).toLowerCase();
    const allowedExt = EXT_BY_KIND[kind];
    if (!allowedExt?.has(ext)) {
      return { ok: false, error: `Extensión no permitida: ${ext || "(sin extensión)"}` };
    }

    return null;
  }

  function finishReadableFile(resolved, kind, stat, allowed) {
    if (!allowed) {
      warn("[beru][security] Path outside trusted roots:", resolved);
      return { ok: false, error: "Archivo fuera de ubicaciones permitidas" };
    }

    const maxBytes = MAX_BYTES_BY_KIND[kind];
    if (stat.size > maxBytes) {
      return { ok: false, error: "Archivo demasiado grande" };
    }

    return { ok: true, resolvedPath: resolved };
  }

  async function inspectReadableFileAsync(filePath, kind) {
    const resolved = await resolveSafeAsync(filePath);
    if (!resolved) return { ok: false, error: "Ruta inválida" };
    if (location.isDenied(resolved)) {
      warn("[beru][security] Denied read:", resolved);
      return { ok: false, error: "Ruta no permitida" };
    }
    let stat;
    try {
      stat = await fs.promises.stat(resolved);
    } catch {
      return { ok: false, error: "Archivo no encontrado" };
    }
    const error = inspectFileStat(resolved, kind, stat);
    if (error) return error;
    const allowed = consent.hasReadConsent(resolved) || (await location.isUnderRootAsync(resolved));
    return finishReadableFile(resolved, kind, stat, allowed);
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
    const kind = EXT_BY_KIND.image.has(ext)
      ? "image"
      : EXT_BY_KIND.audio.has(ext)
        ? "audio"
        : "video";
    return inspectReadableFile(filePath, kind, { statFn: protocolStat });
  }

  return {
    inspectReadableFile,
    inspectReadableFileAsync,
    inspectShellPath,
    inspectOutputDirectory,
    inspectProtocolFile,
  };
}
