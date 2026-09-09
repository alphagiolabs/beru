import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  validateInputPathReadableAsync,
  findUnreadableInputsAsync,
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
    } catch {}
  });

  it("accepts a normal local file", async () => {
    const f = path.join(tmpDir, "normal.mp4");
    fs.writeFileSync(f, Buffer.from("some content"));
    const res = await validateInputPathReadableAsync(f);
    expect(res.ok).toBe(true);
  });

  it("rejects an empty path", async () => {
    expect((await validateInputPathReadableAsync("")).ok).toBe(false);
    expect((await validateInputPathReadableAsync(null)).ok).toBe(false);
    expect((await validateInputPathReadableAsync(undefined)).ok).toBe(false);
  });

  it("rejects a non-existent path", async () => {
    const res = await validateInputPathReadableAsync(path.join(tmpDir, "missing.mp4"));
    expect(res.ok).toBe(false);
    expect(res.code).toBe("missing");
  });

  it("rejects a zero-byte file", async () => {
    const f = path.join(tmpDir, "empty.mp4");
    fs.writeFileSync(f, Buffer.alloc(0));
    const res = await validateInputPathReadableAsync(f);
    expect(res.ok).toBe(false);
    expect(res.code).toBe("empty");
  });

  it("rejects a dangling symlink (OneDrive cloud-only placeholder shape)", async () => {
    if (process.platform === "win32" && process.env.SKIP_DANGLING_TEST === "1") {
      return;
    }
    const f = path.join(tmpDir, "Mi_Video.mp4");
    try {
      fs.symlinkSync(path.join(tmpDir, "cloud-source.mp4"), f, "file");
    } catch {
      return;
    }
    const res = await validateInputPathReadableAsync(f);
    expect(res.ok).toBe(false);
    expect(["missing", "unreadable", "cloud_only"]).toContain(res.code);
  });

  it("finds every unreadable input in a job list", async () => {
    const good = path.join(tmpDir, "good.mp4");
    fs.writeFileSync(good, Buffer.from("ok"));
    const bad = path.join(tmpDir, "ghost.mp4");
    const jobs = [{ input_path: good }, { input_path: bad }, { input_path: "" }, {}];
    const issues = await findUnreadableInputsAsync(jobs);
    expect(issues).toHaveLength(1);
    expect(issues[0].inputPath).toBe(bad);
  });

  it("finds unreadable inputs asynchronously while preserving job order", async () => {
    const good = path.join(tmpDir, "good-async.mp4");
    fs.writeFileSync(good, Buffer.from("ok"));
    const firstBad = path.join(tmpDir, "ghost-a.mp4");
    const secondBad = path.join(tmpDir, "ghost-b.mp4");
    const issues = await findUnreadableInputsAsync([
      { input_path: firstBad },
      { input_path: good },
      { input_path: secondBad },
    ]);
    expect(issues.map((issue) => issue.inputPath)).toEqual([firstBad, secondBad]);
  });

  it("translates generic ENOENT into a missing-file message (not cloud)", () => {
    const msg = translateProcessorErrorMessage(
      "Process exited with code 1: ffmpeg error: ENOENT: no such file or directory",
    );
    expect(msg).toMatch(/No se encontró un archivo/i);
    expect(msg).not.toMatch(/OneDrive|Google Drive|Dropbox/);
  });

  it("translates cloud-path ENOENT into OneDrive guidance", () => {
    const msg = translateProcessorErrorMessage(
      "ffmpeg: error: No such file or directory: 'C:\\Users\\me\\OneDrive\\Videos\\video.mp4'",
    );
    expect(msg).toMatch(/no está disponible localmente/);
    expect(msg).toMatch(/OneDrive|Google Drive|Dropbox/);
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
