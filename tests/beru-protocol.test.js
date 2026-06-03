import { describe, it, expect } from "vitest";
import { filePathFromBeruUrl, validateBeruRequestPath } from "../main/utils/beru-protocol.js";

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
});
