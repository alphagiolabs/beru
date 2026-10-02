import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const scriptPath = path.join(process.cwd(), "scripts", "fetch-ffmpeg.mjs");
const src = fs.readFileSync(scriptPath, "utf-8");

describe("scripts/fetch-ffmpeg.mjs: ffprobe export shape validation", () => {
  it("does not use the bare `?.path || module` fallback pattern", () => {
    expect(src).not.toMatch(/ffprobeModule\?\.path\s*\|\|\s*ffprobeModule/);
  });

  it("validates the resolved ffprobe path is a string before using it", () => {
    expect(src).toMatch(/typeof\s+ffprobeModule(\?\.path)?\s*===\s*["']string["']/);
    expect(src).toMatch(/(process\.exit\(|throw new Error\()/);
  });
});
