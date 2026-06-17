import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  validateInputPathReadable,
  findUnreadableInputs,
  translateProcessorErrorMessage,
} from "../main/utils/process-input-validation.js";

describe("process:start input path validation (regression: ENOENT for cloud placeholders)", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "beru-proc-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("accepts a normal local file", () => {
    const f = path.join(tmpDir, "normal.mp4");
    fs.writeFileSync(f, Buffer.from("some content"));
    const res = validateInputPathReadable(f);
    expect(res.ok).toBe(true);
  });

  it("rejects an empty path", () => {
    expect(validateInputPathReadable("").ok).toBe(false);
    expect(validateInputPathReadable(null).ok).toBe(false);
    expect(validateInputPathReadable(undefined).ok).toBe(false);
  });

  it("rejects a non-existent path", () => {
    const res = validateInputPathReadable(path.join(tmpDir, "missing.mp4"));
    expect(res.ok).toBe(false);
    expect(res.code).toBe("missing");
  });

  it("rejects a zero-byte file", () => {
    const f = path.join(tmpDir, "empty.mp4");
    fs.writeFileSync(f, Buffer.alloc(0));
    const res = validateInputPathReadable(f);
    expect(res.ok).toBe(false);
    expect(res.code).toBe("empty");
  });

  it("rejects a dangling symlink (OneDrive cloud-only placeholder shape)", () => {
    if (process.platform === "win32" && process.env.SKIP_DANGLING_TEST === "1") {
      return;
    }
    const f = path.join(tmpDir, "Mi_Video.mp4");
    try {
      fs.symlinkSync(path.join(tmpDir, "cloud-source.mp4"), f, "file");
    } catch {
      return;
    }
    const res = validateInputPathReadable(f);
    expect(res.ok).toBe(false);
    expect(["missing", "unreadable", "cloud_only"]).toContain(res.code);
  });

  it("finds every unreadable input in a job list", () => {
    const good = path.join(tmpDir, "good.mp4");
    fs.writeFileSync(good, Buffer.from("ok"));
    const bad = path.join(tmpDir, "ghost.mp4");
    const jobs = [{ input_path: good }, { input_path: bad }, { input_path: "" }, {}];
    const issues = findUnreadableInputs(jobs);
    expect(issues).toHaveLength(1);
    expect(issues[0].inputPath).toBe(bad);
  });

  it("translates raw ENOENT into an actionable message", () => {
    const msg = translateProcessorErrorMessage(
      "Process exited with code 1: ffmpeg error: ENOENT: no such file or directory",
    );
    expect(msg).toMatch(/no está disponible localmente/);
    expect(msg).toMatch(/OneDrive|Google Drive|Dropbox/);
  });

  it("translates 'No such file or directory' into an actionable message", () => {
    const msg = translateProcessorErrorMessage(
      "ffmpeg: error: No such file or directory: 'C:\\Users\\me\\OneDrive\\Videos\\video.mp4'",
    );
    expect(msg).toMatch(/no está disponible localmente/);
  });

  it("passes unrelated errors through unchanged", () => {
    const msg = "Process exited with code 1: Invalid argument";
    expect(translateProcessorErrorMessage(msg)).toBe(msg);
  });

  it("translates spawn py ENOENT into a Python install message", () => {
    const msg = translateProcessorErrorMessage("spawn py ENOENT");
    expect(msg).toMatch(/Python 3 no está instalado/i);
  });

  it("translates font/drawtext ENOENT into a font message, not the cloud message", () => {
    // Raw ffmpeg stderr snippet that may reach translateProcessorErrorMessage
    // via the process-close stderr tail (process.js). Must agree with
    // python/batch_errors.py format_processing_error's font branch.
    const cases = [
      "ffmpeg error: Cannot find fontfile 'C:\\Windows\\Fonts\\Missing.ttf': ENOENT",
      "drawtext: No such file or directory for fontfile",
      "[Parsed_drawtext] font not found: ENOENT",
    ];
    for (const raw of cases) {
      const msg = translateProcessorErrorMessage(raw);
      expect(msg, `for ${raw}`).toMatch(/fuente tipográfica/i);
      expect(msg, `for ${raw}`).not.toMatch(/OneDrive|Google Drive|Dropbox/);
    }
  });
});
