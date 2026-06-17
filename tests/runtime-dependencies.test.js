import { describe, it, expect, vi } from "vitest";
import fs from "fs";

vi.mock("electron", () => ({ app: { isPackaged: false } }));

import {
  validatePythonAvailable,
  resolvePythonSpawn,
  getBundledProcessorPath,
} from "../main/utils/python-spawn.js";
import { getFfmpegPath, getFfprobePath, validateMediaBinaries } from "../main/utils/paths.js";
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
describe("python-spawn", () => {
  it("resolvePythonSpawn returns a command or null (never throws)", () => {
    const resolved = resolvePythonSpawn();
    if (resolved === null) {
      // Valid on machines without Python — the app surfaces a clear error.
      return;
    }
    expect(resolved.command).toBeTruthy();
    expect(Array.isArray(resolved.args)).toBe(true);
  });

  it("validatePythonAvailable reports ok:true or a helpful error", () => {
    const check = validatePythonAvailable();
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
