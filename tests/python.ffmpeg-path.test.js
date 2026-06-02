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

  it("uses BERU_FFMPEG when resolving the runtime ffmpeg path", () => {
    const probe = path.join(os.tmpdir(), `beru-test-runtime-ffmpeg-${Date.now()}.bin`);
    writeFileSync(probe, "");
    try {
      const r = spawnSync(PY, [
        "-c",
        PY_CODE_PREFIX + "import processor; print(processor.find_ffmpeg())",
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

  it("quotes Windows fontfile paths in drawtext filters", () => {
    const code = `
import processor
processor.get_system_fonts = lambda: {"arial": (r"C:\\Windows\\Fonts\\arial.ttf", "arial")}
print(processor.build_drawtext({
    "mode": "text",
    "text": "Hola",
    "font_family": "Arial",
    "region": {"x": 10, "y": 20, "w": 200, "h": 50},
}))
`;
    const r = spawnSync(PY, ["-c", PY_CODE_PREFIX + code], {
      encoding: "utf8",
    });
    if (r.status !== 0) {
      console.error("STDOUT:", r.stdout);
      console.error("STDERR:", r.stderr);
    }
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toContain("fontfile='C\\:/Windows/Fonts/arial.ttf'");
  });

  it("emits drawtext spacing for letter_spacing instead of inserting spaces", () => {
    const code = `
import processor
processor.get_system_fonts = lambda: {"arial": (r"C:\\\\Windows\\\\Fonts\\\\arial.ttf", "arial")}
print(processor.build_drawtext({
    "mode": "text",
    "text": "ABC",
    "font_family": "Arial",
    "letter_spacing": 8,
    "region": {"x": 10, "y": 20, "w": 200, "h": 50},
}))
`;
    const r = spawnSync(PY, ["-c", PY_CODE_PREFIX + code], {
      encoding: "utf8",
    });
    if (r.status !== 0) {
      console.error("STDOUT:", r.stdout);
      console.error("STDERR:", r.stderr);
    }
    expect(r.status).toBe(0);
    const filter = r.stdout.trim();
    expect(filter).toContain("spacing=8");
    expect(filter).toContain("text='ABC'");
    expect(filter).not.toContain("text='A B C'");
  });

  it("uses two automatic workers for hardware encoders that tolerate parallel jobs", () => {
    const code = `
import json
import os
import processor
os.environ.pop("BERU_WORKERS", None)
print(json.dumps([
    processor.resolve_max_workers("h264_nvenc", 4),
    processor.resolve_max_workers("h264_mf", 4),
    processor.resolve_max_workers(None, 1),
]))
`;
    const r = spawnSync(PY, ["-c", PY_CODE_PREFIX + code], {
      encoding: "utf8",
    });
    if (r.status !== 0) {
      console.error("STDOUT:", r.stdout);
      console.error("STDERR:", r.stderr);
    }
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout.trim())).toEqual([2, 1, 1]);
  });

  it("uses BERU_FFPROBE when resolving the runtime ffprobe path", () => {
    const ffmpegProbe = path.join(os.tmpdir(), `beru-test-runtime-ffmpeg-${Date.now()}.bin`);
    const ffprobeProbe = path.join(os.tmpdir(), `beru-test-runtime-ffprobe-${Date.now()}.bin`);
    writeFileSync(ffmpegProbe, "");
    writeFileSync(ffprobeProbe, "");
    try {
      const r = spawnSync(PY, [
        "-c",
        PY_CODE_PREFIX + "import processor; print(processor.find_ffprobe(r'" + ffmpegProbe.replace(/\\/g, "\\\\") + "'))",
      ], {
        env: { ...process.env, BERU_FFPROBE: ffprobeProbe },
        encoding: "utf8",
      });
      if (r.status !== 0) {
        console.error("STDOUT:", r.stdout);
        console.error("STDERR:", r.stderr);
      }
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe(ffprobeProbe);
    } finally {
      try { unlinkSync(ffmpegProbe); } catch {}
      try { unlinkSync(ffprobeProbe); } catch {}
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

  it("does not deadlock while printing batch progress", () => {
    const code = `
import json
import processor
processor.detect_hw_encoder = lambda _ffmpeg: None
processor.get_system_fonts = lambda: {}
processor._process_one = lambda idx, job, ffmpeg_path: {"index": job.get("id", idx), "status": "succeeded"}
result = processor.process_jobs([{"id": 7, "input_path": "C:/tmp/a.mp4"}], "ffmpeg", max_workers=1)
print("RESULT", json.dumps(result, sort_keys=True))
`;
    const r = spawnSync(PY, ["-c", PY_CODE_PREFIX + code], {
      encoding: "utf8",
      timeout: 5000,
    });
    if (r.status !== 0) {
      console.error("STDOUT:", r.stdout);
      console.error("STDERR:", r.stderr);
      console.error("ERROR:", r.error);
    }
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('"file": "a.mp4"');
    expect(r.stdout).toContain('RESULT {"failed": 0, "succeeded": 1, "total": 1}');
  });
});
