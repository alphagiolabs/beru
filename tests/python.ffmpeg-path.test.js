// Regression test for the "python ffmpeg-path" bug:
// `processor.py` must use the bundled ffmpeg/ffprobe when the main process
// passes BERU_FFMPEG / BERU_FFPROBE env vars. Previously the script hardcoded
// "ffmpeg" on PATH, so packaged installs without ffmpeg in PATH would crash.

import { describe, it, expect } from "vitest";
import { spawnSync } from "child_process";
import { writeFileSync, unlinkSync } from "fs";
import path from "path";
import os from "os";

const PY = process.platform === "win32" ? "python" : "python3";

const hasPython = (() => {
  try {
    const r = spawnSync(PY, ["--version"], { encoding: "utf8" });
    return r.status === 0;
  } catch {
    return false;
  }
})();

const describeIfPython = hasPython ? describe : describe.skip;

describeIfPython("python/processor.py ffmpeg path resolution", () => {
  const PY_CODE_PREFIX = "import sys; sys.path.insert(0, 'python'); ";

  it("respects BERU_FFMPEG env var (overrides the 'ffmpeg' default)", () => {
    const probe = path.join(os.tmpdir(), `beru-test-ffmpeg-${Date.now()}.bin`);
    writeFileSync(probe, "");
    try {
      const r = spawnSync(PY, [
        "-c",
        PY_CODE_PREFIX + "import processor; print(processor.FFMPEG)",
      ], {
        env: { ...process.env, BERU_FFMPEG: probe },
        encoding: "utf8",
      });
      if (r.status !== 0) {
        console.error("STDOUT:", r.stdout);
        console.error("STDERR:", r.stderr);
      }
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe(probe);
    } finally {
      try { unlinkSync(probe); } catch {}
    }
  });

  it("respects BERU_FFPROBE env var", () => {
    const probe = path.join(os.tmpdir(), `beru-test-ffprobe-${Date.now()}.bin`);
    writeFileSync(probe, "");
    try {
      const r = spawnSync(PY, [
        "-c",
        PY_CODE_PREFIX + "import processor; print(processor.FFPROBE)",
      ], {
        env: { ...process.env, BERU_FFPROBE: probe },
        encoding: "utf8",
      });
      if (r.status !== 0) {
        console.error("STDOUT:", r.stdout);
        console.error("STDERR:", r.stderr);
      }
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe(probe);
    } finally {
      try { unlinkSync(probe); } catch {}
    }
  });

  it("falls back to 'ffmpeg' / 'ffprobe' string when env vars are absent", () => {
    const env = { ...process.env };
    delete env.BERU_FFMPEG;
    delete env.BERU_FFPROBE;
    const r = spawnSync(PY, [
      "-c",
      PY_CODE_PREFIX + "import processor; print(processor.FFMPEG, processor.FFPROBE)",
    ], { env, encoding: "utf8" });
    if (r.status !== 0) {
      console.error("STDOUT:", r.stdout);
      console.error("STDERR:", r.stderr);
    }
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("ffmpeg ffprobe");
  });
});


