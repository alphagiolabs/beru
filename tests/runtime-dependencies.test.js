import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";

vi.mock("electron", () => ({ app: { isPackaged: false } }));

import {
  validateProcessorAvailable,
  resolveProcessorSpawn,
  getBundledProcessorPath,
} from "../main/utils/processor-spawn.js";
import {
  getFfmpegPath,
  getFfprobePath,
  getPythonPath,
  validateMediaBinaries,
} from "../main/utils/paths.js";
import { translateProcessorErrorMessage } from "../main/utils/process-input-validation.js";

/**
 * Runtime-dependency tests.
 *
 * These tests must NOT assume Python or FFmpeg are present on the machine.
 * On a fresh CI runner or a clean dev box the binaries may be absent, and
 * that is a valid state — the app is expected to surface a clear Spanish
 * error, not crash. So each presence assertion is paired with the absence
 * path: if the dependency is missing, we assert the helper reports a
 * helpful `ok: false` instead of throwing or returning undefined.
 */
describe("processor-spawn", () => {
  it("resolveProcessorSpawn returns a spawn spec or null (never throws)", () => {
    const resolved = resolveProcessorSpawn([]);
    if (resolved === null) {
      // Valid on machines without Python — the app surfaces a clear error.
      return;
    }
    expect(resolved.command).toBeTruthy();
    expect(Array.isArray(resolved.args)).toBe(true);
    expect(["bundled", "script"]).toContain(resolved.mode);
  });

  it("validateProcessorAvailable reports ok:true or a helpful error", () => {
    const check = validateProcessorAvailable();
    if (check.ok) {
      expect(check.command).toBeTruthy();
      return;
    }
    // Absence path: must be a string error mentioning Python / install.
    expect(typeof check.error).toBe("string");
    expect(check.error.length).toBeGreaterThan(0);
    expect(/Python|instal|processor/i.test(check.error)).toBe(true);
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
    // Guard against reintroducing a packaged .py fallback: prod must only
    // return bundled mode or null (see resolveProcessorSpawn).
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
    // It is valid for both to be null on a machine without bundled/system binaries.
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

describe("translateProcessorErrorMessage spawn errors", () => {
  it("translates spawn py ENOENT into an actionable Python install message", () => {
    const msg = translateProcessorErrorMessage("spawn py ENOENT");
    expect(msg).toMatch(/Python 3 no está instalado/i);
  });
});
