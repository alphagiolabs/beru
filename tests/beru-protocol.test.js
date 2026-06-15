import { describe, it, expect } from "vitest";
import { writeFileSync, unlinkSync } from "fs";
import path from "path";
import os from "os";
import {
  createBeruVideoResponse,
  filePathFromBeruUrl,
  validateBeruRequestPath,
} from "../main/utils/beru-protocol.js";

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
});
