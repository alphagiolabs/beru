import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";

vi.mock("electron", () => ({ app: { isPackaged: false } }));

import {
  validateProcessorAvailableAsync,
  resolveProcessorSpawnAsync,
  getBundledProcessorPath,
} from "../main/utils/processor-spawn.js";
import {
  getFfmpegPath,
  getFfprobePath,
  getPythonPath,
  validateMediaBinaries,
} from "../main/utils/paths.js";

describe("processor-spawn", () => {
  it("resolves and validates the processor asynchronously", async () => {
    const [resolved, check] = await Promise.all([
      resolveProcessorSpawnAsync([]),
      validateProcessorAvailableAsync(),
    ]);
    expect(check.ok).toBe(Boolean(resolved));
    if (resolved) {
      expect(check.command).toBe(resolved.command);
      expect(check.args).toEqual(resolved.args);
    } else {
      expect(check.error).toMatch(/Python|instal|processor/i);
    }
  });

  it("bundled processor binary: present-and-valid OR absent (never partial)", () => {
    const bundled = getBundledProcessorPath();
    if (!bundled) return; // Not built yet — fine in dev.
    expect(fs.existsSync(bundled)).toBe(true);
  });

  it("getPythonPath points at repo sources, not packaged resources/python", () => {
    const scriptPath = getPythonPath();
    const normalized = scriptPath.replace(/\\/g, "/");
    expect(normalized.endsWith("python/processor.py")).toBe(true);
    expect(normalized).not.toMatch(/resources\/python\//);
    expect(fs.existsSync(scriptPath)).toBe(true);
  });

  it("production spawn path never uses resources/python (source contract)", () => {
    const spawnSrc = fs.readFileSync(
      path.join(process.cwd(), "main", "utils", "processor-spawn.js"),
      "utf-8",
    );
    expect(spawnSrc).toMatch(/if\s*\(\s*!isDev\s*\)/);
    expect(spawnSrc).toMatch(/mode:\s*["']bundled["']/);
    expect(spawnSrc).not.toMatch(/resourcesPath.*python/);

    const pathsSrc = fs.readFileSync(
      path.join(process.cwd(), "main", "utils", "paths.js"),
      "utf-8",
    );
    expect(pathsSrc).not.toMatch(/resourcesPath,\s*["']python["']/);
  });
});

describe("paths media binaries", () => {
  it("ffmpeg/ffprobe resolve to an existing file or null (never a dead path)", () => {
    const ffmpeg = getFfmpegPath();
    const ffprobe = getFfprobePath();
    if (ffmpeg) expect(fs.existsSync(ffmpeg)).toBe(true);
    if (ffprobe) expect(fs.existsSync(ffprobe)).toBe(true);
  });

  it("validateMediaBinaries reports ok:true or a helpful reinstall error", () => {
    const check = validateMediaBinaries();
    if (check.ok) {
      expect(check.ffmpegPath).toBeTruthy();
      expect(check.ffprobePath).toBeTruthy();
      return;
    }
    expect(typeof check.error).toBe("string");
    expect(/FFmpeg|ffprobe|instal/i.test(check.error)).toBe(true);
  });
});
