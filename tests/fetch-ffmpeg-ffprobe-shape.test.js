import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * Regression: `scripts/fetch-ffmpeg.mjs` resolved the ffprobe binary path with
 * `ffprobeModule?.path || ffprobeModule`. If `ffprobe-static` ever changes its
 * export shape (or a misconfigured install returns an object without `.path`),
 * the fallback would be the object itself, `basename()` would return
 * "[object Object]", and `copyFileSync` would fail silently because the
 * postinstall hook swallows errors. The fix validates the resolved path is a
 * string before using it.
 */

const scriptPath = path.join(process.cwd(), "scripts", "fetch-ffmpeg.mjs");
const src = fs.readFileSync(scriptPath, "utf-8");

describe("scripts/fetch-ffmpeg.mjs: ffprobe export shape validation", () => {
  it("does not use the bare `?.path || module` fallback pattern", () => {
    // The bug pattern: a one-liner that falls back to the module object.
    expect(src).not.toMatch(/ffprobeModule\?\.path\s*\|\|\s*ffprobeModule/);
  });

  it("validates the resolved ffprobe path is a string before using it", () => {
    // The fix must explicitly check `typeof ... === "string"` (either for the
    // module itself or for `.path`) and bail with a clear error otherwise.
    expect(src).toMatch(/typeof\s+ffprobeModule(\?\.path)?\s*===\s*["']string["']/);
    // And it must exit (or throw) when the path is invalid, not fall through.
    expect(src).toMatch(/(process\.exit\(|throw new Error\()/);
  });
});
