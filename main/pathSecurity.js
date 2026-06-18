import fs from "fs";
import path from "path";

const NULL_BYTE = /\0/;

const DENIED_PATH_FRAGMENTS = [
  "\\windows\\system32",
  "\\windows\\syswow64",
  "\\program files\\windowsapps",
  "/etc/passwd",
  "/etc/shadow",
  "/proc/",
  "/sys/",
];

/** @typedef {'excel' | 'image' | 'video' | 'project'} ReadKind */

/**
 * Path allow-list for IPC reads initiated by the renderer.
 * Dialog picks register exact files; media under trusted user dirs is allowed.
 */
export function createPathSecurity(app) {
  const allowedFiles = new Set();
  const ALLOWED_FILES_MAX = 2000;

  function trimAllowedFiles() {
    if (allowedFiles.size <= ALLOWED_FILES_MAX) return;
    // Evict oldest entries (first inserted) — Set preserves insertion order
    const excess = allowedFiles.size - ALLOWED_FILES_MAX;
    let count = 0;
    for (const key of allowedFiles) {
      if (count >= excess) break;
      allowedFiles.delete(key);
      count++;
    }
  }

  let _cachedTrustedRoots = null;
  let _trustedRootsCacheTime = 0;
  const TRUSTED_ROOTS_TTL_MS = 30_000;

  const trustedRoots = () => {
    const now = Date.now();
    if (_cachedTrustedRoots && now - _trustedRootsCacheTime < TRUSTED_ROOTS_TTL_MS) {
      return _cachedTrustedRoots;
    }
    const roots = [
      app.getPath("userData"),
      app.getPath("temp"),
      app.getPath("home"),
      app.getPath("documents"),
      app.getPath("downloads"),
      app.getPath("desktop"),
      app.getPath("videos"),
      app.getPath("music"),
      app.getPath("pictures"),
    ];
    if (app.isPackaged && process.resourcesPath) {
      roots.push(process.resourcesPath);
    } else {
      roots.push(app.getAppPath());
    }
    _cachedTrustedRoots = roots.filter(Boolean).map((r) => normalizeKey(path.resolve(r)));
    _trustedRootsCacheTime = now;
    return _cachedTrustedRoots;
  };

  function normalizeKey(p) {
    const n = path.normalize(p);
    return process.platform === "win32" ? n.toLowerCase() : n;
  }

  function resolveSafe(filePath) {
    if (typeof filePath !== "string" || !filePath.trim() || NULL_BYTE.test(filePath)) {
      return null;
    }
    try {
      return fs.realpathSync.native ? fs.realpathSync.native(filePath) : fs.realpathSync(filePath);
    } catch {
      // realpathSync throws ENOENT when the leaf doesn't exist (or for a broken
      // symlink). Falling back to path.resolve would skip ALL symlink resolution,
      // so a symlink planted inside a trusted root pointing elsewhere could pass
      // the lexical isUnderTrustedRoot check while shell.openPath later follows
      // it outside the sandbox. Resolve the longest existing ancestor with
      // realpath, then re-append the remaining (possibly non-existent) tail so
      // the ancestor symlinks are still collapsed.
      try {
        const resolved = path.resolve(filePath);
        let dir = resolved;
        let tail = [];
        // Walk up until an existing ancestor is found.
        while (dir !== path.dirname(dir)) {
          try {
            const realDir = fs.realpathSync.native
              ? fs.realpathSync.native(dir)
              : fs.realpathSync(dir);
            return tail.length ? path.join(realDir, ...tail) : realDir;
          } catch {
            tail.unshift(path.basename(dir));
            dir = path.dirname(dir);
          }
        }
        // Reached the root without an existing ancestor — best effort.
        return path.resolve(filePath);
      } catch {
        return null;
      }
    }
  }

  function isDeniedPath(resolved) {
    const key = normalizeKey(resolved);
    return DENIED_PATH_FRAGMENTS.some((frag) => key.includes(frag));
  }

  function isUnderTrustedRoot(resolved) {
    const key = normalizeKey(resolved);
    return trustedRoots().some((root) => key === root || key.startsWith(`${root}${path.sep}`));
  }

  function registerAllowedPath(filePath) {
    const resolved = resolveSafe(filePath);
    if (!resolved) return;
    allowedFiles.add(normalizeKey(resolved));
    trimAllowedFiles();
  }

  function registerAllowedPaths(paths) {
    if (!Array.isArray(paths)) return;
    for (const p of paths) registerAllowedPath(p);
  }

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

  /**
   * @param {string} filePath
   * @param {ReadKind} kind
   * @returns {{ ok: true, resolvedPath: string } | { ok: false, error: string }}
   */
  function validateReadableFile(filePath, kind) {
    const resolved = resolveSafe(filePath);
    if (!resolved) {
      return { ok: false, error: "Ruta inválida" };
    }
    if (isDeniedPath(resolved)) {
      console.warn("[beru][security] Denied read:", resolved);
      return { ok: false, error: "Ruta no permitida" };
    }

    let stat;
    try {
      stat = fs.statSync(resolved);
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

    const key = normalizeKey(resolved);
    const explicitlyAllowed = allowedFiles.has(key);
    if (!explicitlyAllowed && !isUnderTrustedRoot(resolved)) {
      console.warn("[beru][security] Path outside trusted roots:", resolved);
      return { ok: false, error: "Archivo fuera de ubicaciones permitidas" };
    }

    const maxBytes = MAX_BYTES_BY_KIND[kind] ?? 50 * 1024 * 1024;
    if (stat.size > maxBytes) {
      return { ok: false, error: "Archivo demasiado grande" };
    }

    return { ok: true, resolvedPath: resolved };
  }

  /** Open in Explorer / shell — file or directory under trusted roots or allow-list. */
  function validateShellPath(targetPath) {
    const resolved = resolveSafe(targetPath);
    if (!resolved) return { ok: false, error: "Ruta inválida" };
    if (isDeniedPath(resolved)) {
      return { ok: false, error: "Ruta no permitida" };
    }
    const key = normalizeKey(resolved);
    if (!allowedFiles.has(key) && !isUnderTrustedRoot(resolved)) {
      return { ok: false, error: "Ruta fuera de ubicaciones permitidas" };
    }
    let stat;
    try {
      stat = fs.statSync(resolved);
    } catch {
      return { ok: false, error: "Archivo no encontrado" };
    }
    if (!stat.isFile() && !stat.isDirectory()) {
      return { ok: false, error: "Ruta no permitida" };
    }
    return { ok: true, resolvedPath: resolved };
  }

  function validateProtocolFile(filePath) {
    return validateReadableFile(filePath, "video");
  }

  return {
    registerAllowedPath,
    registerAllowedPaths,
    validateReadableFile,
    validateShellPath,
    validateProtocolFile,
  };
}
