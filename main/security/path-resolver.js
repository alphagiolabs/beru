import fs from "fs";
import path from "path";
import { trimOldest } from "../utils/cache-trim.js";

const NULL_BYTE = /\0/;
const RESOLVE_CACHE_MAX = 4000;

const defaultRealpath = (p) =>
  fs.realpathSync.native ? fs.realpathSync.native(p) : fs.realpathSync(p);

export function createPathResolver({ realpath = defaultRealpath, env = process.env } = {}) {
  const resolveCache = new Map();
  const resolveCacheTtlMs = () => Number(env.BERU_RESOLVE_CACHE_TTL_MS) || 5000;
  const cacheEnabled = () => env.BERU_RESOLVE_CACHE !== "0";

  function normalizeKey(p) {
    return path.normalize(p).toLowerCase();
  }

  function resolveSafe(filePath) {
    if (typeof filePath !== "string" || !filePath.trim() || NULL_BYTE.test(filePath)) {
      return null;
    }
    if (cacheEnabled()) {
      const hit = resolveCache.get(filePath);
      if (hit && Date.now() - hit.ts <= resolveCacheTtlMs()) return hit.resolved;
    }
    const resolved = resolveSafeUncached(filePath);
    if (cacheEnabled()) {
      resolveCache.set(filePath, { resolved, ts: Date.now() });
      trimOldest(resolveCache, RESOLVE_CACHE_MAX);
    }
    return resolved;
  }

  function resolveSafeUncached(filePath) {
    try {
      return realpath(filePath);
    } catch {
      try {
        const resolved = path.resolve(filePath);
        let dir = resolved;
        let tail = [];
        while (dir !== path.dirname(dir)) {
          try {
            const realDir = realpath(dir);
            return tail.length ? path.join(realDir, ...tail) : realDir;
          } catch {
            tail.unshift(path.basename(dir));
            dir = path.dirname(dir);
          }
        }
        return path.resolve(filePath);
      } catch {
        return null;
      }
    }
  }

  return { resolveSafe, normalizeKey };
}
