import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import { writeFileSync, unlinkSync, mkdtempSync, rmSync } from "fs";
import path from "path";
import os from "os";
import {
  createBeruVideoResponse,
  filePathFromBeruUrl,
  hasKnownBeruType,
  validateBeruRequestPath,
  invalidateBeruStatCache,
} from "../main/utils/beru-protocol.js";
import { createRunOutputFiles } from "../main/utils/process-output.js";
import { createPathSecurity } from "../main/pathSecurity.js";

describe("beru protocol path parsing", () => {
  it.each([
    ["Windows absolute path", "C:\\videos\\clip.mp4"],
    ["POSIX absolute path", "/home/user/clip.mp4"],
    ["backslash UNC path without a spurious leading slash", "\\\\server\\share\\clip.mp4"],
    ["forward-slash UNC path", "//server/share/clip.mp4"],
  ])("parses an encoded %s", (_label, filePath) => {
    expect(filePathFromBeruUrl(`beru://local/${encodeURIComponent(filePath)}`)).toBe(filePath);
  });

  it("ignores a cache-busting ?v= query in the path lookup", () => {
    const filePath = "C:\\imgs\\logo.png";
    expect(
      filePathFromBeruUrl(`beru://local/${encodeURIComponent(filePath)}?v=1700000000000-4`),
    ).toBe(filePath);
  });

  it("rejects non-local beru hosts", () => {
    expect(filePathFromBeruUrl("beru://remote/%2Fhome%2Fuser%2Fclip.mp4")).toBeNull();
  });

  it("rejects uppercase beru hosts to prevent case bypass", () => {
    expect(filePathFromBeruUrl("beru://LOCAL/%2Fhome%2Fuser%2Fclip.mp4")).toBeNull();
    expect(filePathFromBeruUrl("beru://Local/%2Fhome%2Fuser%2Fclip.mp4")).toBeNull();
  });

  it("validates resolved protocol paths through pathSecurity", () => {
    const calls = [];
    const pathSecurity = {
      validateProtocolFile: (filePath) => {
        calls.push(filePath);
        return { ok: true, resolvedPath: filePath };
      },
    };

    const result = validateBeruRequestPath(pathSecurity, "beru://local/%2Fhome%2Fuser%2Fclip.mp4");

    expect(result.ok).toBe(true);
    expect(calls).toEqual(["/home/user/clip.mp4"]);
  });

  it("serves byte ranges for video seeking", async () => {
    const tmp = path.join(os.tmpdir(), `beru-protocol-range-${Date.now()}.mp4`);
    writeFileSync(tmp, "0123456789");
    try {
      const response = createBeruVideoResponse(tmp, {
        headers: { get: (name) => (name.toLowerCase() === "range" ? "bytes=2-5" : null) },
      });

      expect(response.status).toBe(206);
      expect(response.headers.get("accept-ranges")).toBe("bytes");
      expect(response.headers.get("content-range")).toBe("bytes 2-5/10");
      expect(response.headers.get("content-length")).toBe("4");
      expect(await response.text()).toBe("2345");
    } finally {
      unlinkSync(tmp);
    }
  });

  it("rejects unsatisfiable byte ranges", () => {
    const tmp = path.join(os.tmpdir(), `beru-protocol-range-invalid-${Date.now()}.mp4`);
    writeFileSync(tmp, "0123456789");
    try {
      const response = createBeruVideoResponse(tmp, {
        headers: { get: (name) => (name.toLowerCase() === "range" ? "bytes=99-120" : null) },
      });

      expect(response.status).toBe(416);
      expect(response.headers.get("content-range")).toBe("bytes */10");
    } finally {
      unlinkSync(tmp);
    }
  });

  it("export completion invalidates the cached stat for the overwritten path", async () => {
    const prev = process.env.BERU_PROTOCOL_STAT_CACHE;
    process.env.BERU_PROTOCOL_STAT_CACHE = "1";
    const dir = mkdtempSync(path.join(os.tmpdir(), "beru-export-cache-"));
    try {
      invalidateBeruStatCache();
      const target = path.join(dir, "out.mp4");
      writeFileSync(target, "old");
      const first = createBeruVideoResponse(target, { headers: { get: () => null } });
      expect(first.headers.get("content-length")).toBe("3");
      await first.text();

      const run = createRunOutputFiles(
        [{ id: 1, input_path: path.join(dir, "in.mp4"), output_path: "out.mp4" }],
        dir,
        { overwrite: true },
      );
      try {
        writeFileSync(run.jobs[0].output_path, "new-content");
        expect(await run.complete(1)).toBe(target);
      } finally {
        run.dispose();
      }

      const second = createBeruVideoResponse(target, { headers: { get: () => null } });
      expect(second.headers.get("content-length")).toBe("11");
      expect(await second.text()).toBe("new-content");
    } finally {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {}
      if (prev === undefined) delete process.env.BERU_PROTOCOL_STAT_CACHE;
      else process.env.BERU_PROTOCOL_STAT_CACHE = prev;
      invalidateBeruStatCache();
    }
  });
});

describe("beru protocol validation stat cache", () => {
  let dir;
  let security;
  let stat;

  beforeEach(() => {
    vi.stubEnv("BERU_PROTOCOL_STAT_CACHE", "1");
    vi.stubEnv("BERU_PROTOCOL_STAT_CACHE_TTL_MS", "5000");
    invalidateBeruStatCache();
    dir = mkdtempSync(path.join(os.tmpdir(), "beru-validation-cache-"));
    stat = vi.spyOn(fs, "statSync");
    security = createPathSecurity({
      getPath: () => dir,
      getAppPath: () => dir,
      isPackaged: false,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    invalidateBeruStatCache();
    rmSync(dir, { recursive: true, force: true });
  });

  it("shares one stat between repeated validation and range responses within the TTL", async () => {
    const file = path.join(dir, "clip.mp4");
    writeFileSync(file, "0123456789");
    for (let i = 0; i < 2; i++) {
      const check = validateBeruRequestPath(security, `beru://local/${encodeURIComponent(file)}`);
      expect(check.ok).toBe(true);
      const response = createBeruVideoResponse(check.resolvedPath, {
        headers: { get: () => "bytes=2-5" },
      });
      expect(response.status).toBe(206);
      expect(response.headers.get("content-range")).toBe("bytes 2-5/10");
      expect(await response.text()).toBe("2345");
    }
    expect(stat).toHaveBeenCalledTimes(1);
  });

  it("refreshes validation and response sizes after the configured TTL", async () => {
    vi.stubEnv("BERU_PROTOCOL_STAT_CACHE_TTL_MS", "25");
    const clock = vi.spyOn(Date, "now").mockReturnValue(10_000);
    const file = path.join(dir, "clip.mp4");
    writeFileSync(file, "old");
    expect(security.validateProtocolFile(file).ok).toBe(true);

    writeFileSync(file, "new-content");
    clock.mockReturnValue(10_025);
    const cached = security.validateProtocolFile(file);
    expect(cached.ok).toBe(true);
    const beforeExpiry = createBeruVideoResponse(cached.resolvedPath, {});
    expect(beforeExpiry.headers.get("content-length")).toBe("3");
    expect(await beforeExpiry.text()).toBe("new");
    expect(stat).toHaveBeenCalledTimes(1);

    clock.mockReturnValue(10_026);
    const fresh = security.validateProtocolFile(file);
    expect(fresh.ok).toBe(true);
    const afterExpiry = createBeruVideoResponse(fresh.resolvedPath, {});
    expect(afterExpiry.headers.get("content-length")).toBe("11");
    expect(await afterExpiry.text()).toBe("new-content");
    expect(stat).toHaveBeenCalledTimes(2);
  });

  it("honors disabling the cache even when metadata is already cached", async () => {
    const file = path.join(dir, "clip.mp4");
    writeFileSync(file, "old");
    expect(security.validateProtocolFile(file).ok).toBe(true);
    writeFileSync(file, "new-content");
    vi.stubEnv("BERU_PROTOCOL_STAT_CACHE", "0");
    const fresh = security.validateProtocolFile(file);
    expect(fresh.ok).toBe(true);
    const response = createBeruVideoResponse(fresh.resolvedPath, {});
    expect(response.headers.get("content-length")).toBe("11");
    expect(await response.text()).toBe("new-content");
    expect(stat).toHaveBeenCalledTimes(3);
  });

  it("invalidates deleted files immediately and does not cache missing-file errors", async () => {
    const file = path.join(dir, "clip.mp4");
    writeFileSync(file, "old");
    const first = security.validateProtocolFile(file);
    expect(first.ok).toBe(true);
    unlinkSync(file);
    invalidateBeruStatCache(first.resolvedPath);
    expect(security.validateProtocolFile(file)).toEqual({
      ok: false,
      error: "Archivo no encontrado",
    });
    writeFileSync(file, "new-content");
    const fresh = security.validateProtocolFile(file);
    expect(fresh.ok).toBe(true);
    const response = createBeruVideoResponse(fresh.resolvedPath, {});
    expect(response.headers.get("content-length")).toBe("11");
    expect(await response.text()).toBe("new-content");
    expect(stat).toHaveBeenCalledTimes(3);
  });

  it.each([
    ["directory.mp4", "La ruta no es un archivo"],
    ["oversized.png", "Archivo demasiado grande"],
    ["unknown.json", "Extensión no permitida: .json"],
  ])("preserves rejection on cache miss and hit for %s", (name, error) => {
    const file = path.join(dir, name);
    if (name.startsWith("directory")) fs.mkdirSync(file);
    else {
      writeFileSync(file, "data");
      if (name.startsWith("oversized")) fs.truncateSync(file, 15 * 1024 * 1024 + 1);
    }
    expect(security.validateProtocolFile(file)).toEqual({ ok: false, error });
    expect(security.validateProtocolFile(file)).toEqual({ ok: false, error });
    expect(stat).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["sheet.xlsx", "excel"],
    ["project.json", "project"],
  ])("keeps normal sync and async reads fresh for %s", async (name, kind) => {
    const file = path.join(dir, name);
    writeFileSync(file, "data");
    expect(security.validateReadableFile(file, kind).ok).toBe(true);
    expect(security.validateReadableFile(file, kind).ok).toBe(true);
    expect(stat).toHaveBeenCalledTimes(2);
    expect((await security.validateReadableFileAsync(file, kind)).ok).toBe(true);
    unlinkSync(file);
    expect(security.validateReadableFile(file, kind)).toEqual({
      ok: false,
      error: "Archivo no encontrado",
    });
    expect(await security.validateReadableFileAsync(file, kind)).toEqual({
      ok: false,
      error: "Archivo no encontrado",
    });
    expect(stat).toHaveBeenCalledTimes(3);
  });

  it("rechecks trusted locations and revoked consent without caching permission", () => {
    const file = path.join(dir, "clip.mp4");
    writeFileSync(file, "video");
    expect(security.validateProtocolFile(file).ok).toBe(true);
    const root = path.join(dir, "trusted");
    fs.mkdirSync(root);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const restricted = createPathSecurity({
      getPath: () => root,
      getAppPath: () => root,
      isPackaged: false,
    });
    expect(restricted.validateProtocolFile(file)).toEqual({
      ok: false,
      error: "Archivo fuera de ubicaciones permitidas",
    });
    expect(restricted.registerSelectedPath(file, "video").ok).toBe(true);
    stat.mockClear();
    expect(restricted.validateProtocolFile(file).ok).toBe(true);
    restricted.releaseVideoPaths([file]);
    expect(restricted.validateProtocolFile(file)).toEqual({
      ok: false,
      error: "Archivo fuera de ubicaciones permitidas",
    });
    expect(stat).not.toHaveBeenCalled();
  });
});

describe("beru protocol fails closed on unknown content types", () => {
  it.each([".xlsx", ".json", ".csv", ".txt", ".exe", ".pdf", ""])(
    "rejects %s as unservable instead of streaming octet-stream",
    (ext) => {
      expect(hasKnownBeruType(`C:\\videos\\clip${ext}`)).toBe(false);
    },
  );

  it("accepts every extension the protocol content-type table covers", () => {
    for (const ext of [
      ".mp4",
      ".m4v",
      ".mov",
      ".webm",
      ".mkv",
      ".avi",
      ".wmv",
      ".flv",
      ".mpg",
      ".mpeg",
      ".webp",
      ".png",
      ".jpg",
      ".jpeg",
      ".gif",
      ".bmp",
    ]) {
      expect(hasKnownBeruType(`C:\\media\\file${ext}`), ext).toBe(true);
    }
  });

  it("is case-insensitive on the extension", () => {
    expect(hasKnownBeruType("C:\\media\\CLIP.MP4")).toBe(true);
    expect(hasKnownBeruType("C:\\media\\SHEET.XLSX")).toBe(false);
  });
});
