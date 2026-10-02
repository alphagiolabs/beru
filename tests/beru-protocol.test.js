import { describe, it, expect } from "vitest";
import { writeFileSync, unlinkSync, readFileSync } from "fs";
import path from "path";
import os from "os";
import {
  createBeruVideoResponse,
  filePathFromBeruUrl,
  hasKnownBeruType,
  validateBeruRequestPath,
  invalidateBeruStatCache,
} from "../main/utils/beru-protocol.js";

const mainSrc = readFileSync(path.join(process.cwd(), "main", "main.js"), "utf8");

describe("beru protocol path parsing", () => {
  it("parses encoded Windows absolute paths", () => {
    const filePath = "C:\\videos\\clip.mp4";
    expect(filePathFromBeruUrl(`beru://local/${encodeURIComponent(filePath)}`)).toBe(filePath);
  });

  it("preserves encoded POSIX absolute paths", () => {
    expect(filePathFromBeruUrl("beru://local/%2Fhome%2Fuser%2Fclip.mp4")).toBe(
      "/home/user/clip.mp4",
    );
  });

  it("preserves backslash UNC paths without a spurious leading slash", () => {
    // \\server\share\clip.mp4. The URL pathname adds a leading "/" that
    // path.resolve on win32 must strip or the UNC is destroyed.
    const unc = "\\\\server\\share\\clip.mp4";
    expect(filePathFromBeruUrl(`beru://local/${encodeURIComponent(unc)}`)).toBe(unc);
  });

  it("preserves forward-slash UNC paths", () => {
    const unc = "//server/share/clip.mp4";
    expect(filePathFromBeruUrl(`beru://local/${encodeURIComponent(unc)}`)).toBe(unc);
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

  it("returns correct size when stat cache is enabled", async () => {
    const prev = process.env.BERU_PROTOCOL_STAT_CACHE;
    process.env.BERU_PROTOCOL_STAT_CACHE = "1";
    try {
      invalidateBeruStatCache();
      const tmp = path.join(os.tmpdir(), `beru-protocol-cache-${Date.now()}.mp4`);
      writeFileSync(tmp, "0123456789");
      try {
        const response1 = createBeruVideoResponse(tmp, {
          headers: { get: () => null },
        });
        expect(response1.status).toBe(200);
        expect(response1.headers.get("content-length")).toBe("10");
        expect(await response1.text()).toBe("0123456789");
        unlinkSync(tmp);
        const response2 = createBeruVideoResponse(tmp, {
          headers: { get: () => null },
        });
        expect(response2.status).toBe(200);
        expect(response2.headers.get("content-length")).toBe("10");
      } finally {
        try {
          unlinkSync(tmp);
        } catch {}
        invalidateBeruStatCache();
      }
    } finally {
      if (prev === undefined) delete process.env.BERU_PROTOCOL_STAT_CACHE;
      else process.env.BERU_PROTOCOL_STAT_CACHE = prev;
      invalidateBeruStatCache();
    }
  });

  it("invalidateBeruStatCache is a no-op when cache disabled", () => {
    const prev = process.env.BERU_PROTOCOL_STAT_CACHE;
    delete process.env.BERU_PROTOCOL_STAT_CACHE;
    try {
      expect(() => invalidateBeruStatCache()).not.toThrow();
      expect(() => invalidateBeruStatCache("C:\\nonexistent.mp4")).not.toThrow();
    } finally {
      if (prev !== undefined) process.env.BERU_PROTOCOL_STAT_CACHE = prev;
    }
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

  it("main.js answers 403 for an unmapped type and never falls back to octet-stream", () => {
    const handler = mainSrc.slice(
      mainSrc.indexOf("function registerBeruProtocol"),
      mainSrc.indexOf("app.commandLine.appendSwitch"),
    );
    expect(handler).toMatch(/if \(!hasKnownBeruType\(check\.resolvedPath\)\)/);
    expect(handler).toMatch(/status: 403/);
    expect(handler.indexOf("hasKnownBeruType")).toBeLessThan(
      handler.indexOf("createBeruVideoResponse"),
    );
  });

  it("no content-type table entry resolves to application/octet-stream", () => {
    const protocolSrc = readFileSync(
      path.join(process.cwd(), "main", "utils", "beru-protocol.js"),
      "utf8",
    );
    const fallback = protocolSrc.match(/function contentTypeFor[\s\S]*?\n}/)?.[0] ?? "";
    expect(fallback).toContain("|| null");
    expect(fallback).not.toContain("application/octet-stream");
  });

  it("registers the beru scheme with corsEnabled disabled", () => {
    const privileges = mainSrc.slice(
      mainSrc.indexOf('scheme: "beru"'),
      mainSrc.indexOf("function registerBeruProtocol"),
    );
    expect(privileges).toMatch(/corsEnabled: false/);
  });
});
