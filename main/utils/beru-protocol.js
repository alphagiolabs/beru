import fs from "fs";
import path from "path";
import { Readable } from "stream";

// --- Stat cache (opt-in) ----------------------------------------------------
// Every beru:// Range request during video scrubbing calls fs.statSync on the
// main thread. For active scrubbing this is dozens of sync stats per second on
// the same file. A short-TTL cache removes the redundant syscalls.
// Enable with BERU_PROTOCOL_STAT_CACHE=1. Default off = current behavior.
const statCache = new Map(); // filePath -> { size, mtimeMs, ts }

// Flags are read at call time (not at module load) so tests can toggle them.
function statCacheEnabled() {
  return process.env.BERU_PROTOCOL_STAT_CACHE === "1";
}

function statCacheTtlMs() {
  return Number(process.env.BERU_PROTOCOL_STAT_CACHE_TTL_MS) || 5000;
}

/** Drop a cached stat entry (e.g. after a file is replaced). Safe to call always. */
export function invalidateBeruStatCache(filePath) {
  if (filePath === undefined) statCache.clear();
  else statCache.delete(filePath);
}

function statFile(filePath) {
  if (statCacheEnabled()) {
    const hit = statCache.get(filePath);
    if (hit && Date.now() - hit.ts <= statCacheTtlMs()) {
      return { size: hit.size, mtimeMs: hit.mtimeMs };
    }
  }
  const stat = fs.statSync(filePath);
  if (statCacheEnabled()) {
    statCache.set(filePath, { size: stat.size, mtimeMs: stat.mtimeMs, ts: Date.now() });
  }
  return { size: stat.size, mtimeMs: stat.mtimeMs };
}

const VIDEO_CONTENT_TYPES = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
  ".wmv": "video/x-ms-wmv",
  ".flv": "video/x-flv",
  ".mpg": "video/mpeg",
  ".mpeg": "video/mpeg",
};

export function filePathFromBeruUrl(requestUrl) {
  const url = new URL(requestUrl);
  if (url.protocol !== "beru:" || url.hostname !== "local") return null;

  const decoded = decodeURIComponent(url.pathname || "");
  if (!decoded) return null;

  if (/^\/[A-Za-z]:[\\/]/.test(decoded)) {
    return decoded.slice(1);
  }
  if (decoded.startsWith("//")) {
    return decoded.slice(1);
  }
  return decoded;
}

export function validateBeruRequestPath(pathSecurity, requestUrl) {
  const filePath = filePathFromBeruUrl(requestUrl);
  if (!filePath) return { ok: false, error: "Ruta inválida" };
  return pathSecurity.validateProtocolFile(filePath);
}

function contentTypeFor(filePath) {
  return VIDEO_CONTENT_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

function parseRangeHeader(rangeHeader, size) {
  if (!rangeHeader || !Number.isFinite(size) || size <= 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(String(rangeHeader).trim());
  if (!match) return { invalid: true };

  const [, startRaw, endRaw] = match;
  if (!startRaw && !endRaw) return { invalid: true };

  let start;
  let end;
  if (!startRaw) {
    const suffixLength = Number(endRaw);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return { invalid: true };
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(startRaw);
    end = endRaw ? Number(endRaw) : size - 1;
  }

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end < start ||
    start >= size
  ) {
    return { invalid: true };
  }

  return {
    start,
    end: Math.min(end, size - 1),
  };
}

function requestHeader(request, name) {
  const headers = request?.headers;
  if (!headers) return null;
  if (typeof headers.get === "function") {
    return headers.get(name) || headers.get(name.toLowerCase()) || null;
  }
  return headers[name] || headers[name.toLowerCase()] || null;
}

function streamResponse(filePath, { status, start, end, size }) {
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Content-Type": contentTypeFor(filePath),
    "Content-Length": String(end - start + 1),
    "Cache-Control": "no-store",
  });
  if (status === 206) {
    headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
  }
  const nodeStream = fs.createReadStream(filePath, { start, end });
  return new Response(Readable.toWeb(nodeStream), { status, headers });
}

export function createBeruVideoResponse(filePath, request) {
  const stat = statFile(filePath);
  const size = stat.size;
  if (size <= 0) {
    return new Response(null, {
      status: 200,
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Type": contentTypeFor(filePath),
        "Content-Length": "0",
        "Cache-Control": "no-store",
      },
    });
  }

  const range = parseRangeHeader(requestHeader(request, "Range"), size);

  if (range?.invalid) {
    return new Response(null, {
      status: 416,
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Range": `bytes */${size}`,
      },
    });
  }

  if (range) {
    return streamResponse(filePath, {
      status: 206,
      start: range.start,
      end: range.end,
      size,
    });
  }

  return streamResponse(filePath, {
    status: 200,
    start: 0,
    end: Math.max(0, size - 1),
    size,
  });
}
