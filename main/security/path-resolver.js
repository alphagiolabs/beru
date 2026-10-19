import fs from "fs";
import path from "path";
import { trimOldest } from "../utils/cache-trim.js";

const NULL_BYTE = /\0/;
const RESOLVE_CACHE_MAX = 4000;

const defaultRealpath = (p) =>
  fs.realpathSync.native ? fs.realpathSync.native(p) : fs.realpathSync(p);

export function createPathResolver({
  realpath = defaultRealpath,
  realpathAsync = fs.promises.realpath,
  env = process.env,
} = {}) {
  const resolveCache = new Map();
  const resolveCacheTtlMs = () => Number(env.BERU_RESOLVE_CACHE_TTL_MS) || 5000;
  const cacheEnabled = () => env.BERU_RESOLVE_CACHE !== "0";

  function normalizeKey(p) {
    return path.normalize(p).toLowerCase();
  }

  function isUsableInput(filePath) {
    return typeof filePath === "string" && Boolean(filePath.trim()) && !NULL_BYTE.test(filePath);
  }

  function cachedEntry(filePath) {
    if (!cacheEnabled()) return undefined;
    const hit = resolveCache.get(filePath);
    return hit && Date.now() - hit.ts <= resolveCacheTtlMs() ? hit : undefined;
  }

  function remember(filePath, resolved) {
    if (!cacheEnabled()) return;
    resolveCache.set(filePath, { resolved, ts: Date.now() });
    trimOldest(resolveCache, RESOLVE_CACHE_MAX);
  }

  function resolveSafe(filePath) {
    if (!isUsableInput(filePath)) return null;
    const hit = cachedEntry(filePath);
    if (hit) return hit.resolved;
    const resolved = resolveSafeUncached(filePath);
    remember(filePath, resolved);
    return resolved;
  }

  function resolveSafeUncached(filePath) {
    try {
      return realpath(filePath);
    } catch {
      try {
        const resolved = path.resolve(filePath);
        let dir = resolved;
        const tail = [];
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

  async function resolveSafeAsync(filePath) {
    if (!isUsableInput(filePath)) return null;
    const hit = cachedEntry(filePath);
    if (hit) return hit.resolved;
    let resolved;
    try {
      resolved = await realpathAsync(filePath);
    } catch {
      resolved = path.resolve(filePath);
      let dir = resolved;
      const tail = [];
      while (dir !== path.dirname(dir)) {
        try {
          const realDir = await realpathAsync(dir);
          resolved = tail.length ? path.join(realDir, ...tail) : realDir;
          break;
        } catch {
          tail.unshift(path.basename(dir));
          dir = path.dirname(dir);
        }
      }
    }
    remember(filePath, resolved);
    return resolved;
  }

  return { resolveSafe, resolveSafeAsync, normalizeKey };
}
