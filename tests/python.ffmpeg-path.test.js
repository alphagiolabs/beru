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
      const r = spawnSync(
        PY,
        ["-c", PY_CODE_PREFIX + "import processor; print(processor.FFMPEG)"],
        {
          env: { ...process.env, BERU_FFMPEG: probe },
          encoding: "utf8",
        },
      );
      if (r.status !== 0) {
        console.error("STDOUT:", r.stdout);
        console.error("STDERR:", r.stderr);
      }
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe(probe);
    } finally {
      try {
        unlinkSync(probe);
      } catch {}
    }
  });

  it("uses BERU_FFMPEG when resolving the runtime ffmpeg path", () => {
    const probe = path.join(os.tmpdir(), `beru-test-runtime-ffmpeg-${Date.now()}.bin`);
    writeFileSync(probe, "");
    try {
      const r = spawnSync(
        PY,
        ["-c", PY_CODE_PREFIX + "import processor; print(processor.find_ffmpeg())"],
        {
          env: { ...process.env, BERU_FFMPEG: probe },
          encoding: "utf8",
        },
      );
      if (r.status !== 0) {
        console.error("STDOUT:", r.stdout);
        console.error("STDERR:", r.stderr);
      }
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe(probe);
    } finally {
      try {
        unlinkSync(probe);
      } catch {}
    }
  });

  it("respects BERU_FFPROBE env var", () => {
    const probe = path.join(os.tmpdir(), `beru-test-ffprobe-${Date.now()}.bin`);
    writeFileSync(probe, "");
    try {
      const r = spawnSync(
        PY,
        ["-c", PY_CODE_PREFIX + "import processor; print(processor.FFPROBE)"],
        {
          env: { ...process.env, BERU_FFPROBE: probe },
          encoding: "utf8",
        },
      );
      if (r.status !== 0) {
        console.error("STDOUT:", r.stdout);
        console.error("STDERR:", r.stderr);
      }
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe(probe);
    } finally {
      try {
        unlinkSync(probe);
      } catch {}
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

  it("skips empty drawtext filters (ffmpeg EINVAL on text='')", () => {
    const code = `
import processor
print(processor.build_drawtext({
    "mode": "text",
    "text": "",
    "region": {"x": 10, "y": 20, "w": 200, "h": 50},
}))
`;
    const r = spawnSync(PY, ["-c", PY_CODE_PREFIX + code], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("None");
  });

  it("build_filter_complex ignores blank text operations", () => {
    const code = `
import processor
graph, last, imgs = processor.build_filter_complex([
    {"mode": "text", "text": "", "region": {"x": 0.1, "y": 0.1, "w": 0.2, "h": 0.1}},
    {"mode": "text", "text": "Hola", "region": {"x": 0.2, "y": 0.2, "w": 0.2, "h": 0.1}},
], 1920, 1080)
print(graph is not None and "drawtext" in graph and "Hola" in graph)
`;
    const r = spawnSync(PY, ["-c", PY_CODE_PREFIX + code], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("True");
  });

  it("uses pixel coordinates for normalized text regions in filter graphs", () => {
    const code = `
import processor
processor.get_system_fonts = lambda: {"arial": (r"C:\\\\Windows\\\\Fonts\\\\arial.ttf", "arial")}
graph, last, imgs = processor.build_filter_complex([
    {"mode": "text", "text": "Hola", "font_family": "Arial", "region": {"x": 0.1, "y": 0.2, "w": 0.3, "h": 0.1}},
], 1920, 1080)
print("x=192" in graph and "y=216" in graph)
`;
    const r = spawnSync(PY, ["-c", PY_CODE_PREFIX + code], { encoding: "utf8" });
    if (r.status !== 0) {
      console.error("STDOUT:", r.stdout);
      console.error("STDERR:", r.stderr);
    }
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("True");
  });

  it("emits drawtext spacing for letter_spacing instead of inserting spaces", () => {
    const code = `
import processor
processor.get_system_fonts = lambda: {"arial": (r"C:\\\\Windows\\\\Fonts\\\\arial.ttf", "arial")}
processor._DRAWTEXT_OPTIONS_CACHE = {"spacing"}
processor._DRAWTEXT_OPTIONS_CACHE_FOR = processor.FFMPEG
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

  it("omits unsupported drawtext style options", () => {
    const code = `
import processor
processor.get_system_fonts = lambda: {"arial": (r"C:\\\\Windows\\\\Fonts\\\\arial.ttf", "arial")}
processor._DRAWTEXT_OPTIONS_CACHE = set()
processor._DRAWTEXT_OPTIONS_CACHE_FOR = processor.FFMPEG
print(processor.build_drawtext({
    "mode": "text",
    "text": "ABC",
    "font_family": "Arial",
    "font_weight": 400,
    "letter_spacing": 8,
    "italic": True,
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
    expect(filter).toContain("text='ABC'");
    expect(filter).not.toContain("fontweight=");
    expect(filter).not.toContain("fontstyle=");
    expect(filter).not.toContain("spacing=");
  });

  it("conservative auto caps GPU at 2 and MF at 1", () => {
    const code = `
import json
import os
import processor
os.environ.pop("BERU_WORKERS", None)
os.environ["BERU_WORKERS_MODE"] = "conservative"
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

  it("balanced auto reaches 5 workers for NVENC when job count allows", () => {
    const code = `
import json
import os
import processor
os.environ.pop("BERU_WORKERS", None)
os.environ["BERU_WORKERS_MODE"] = "balanced"
print(json.dumps(processor.resolve_max_workers("h264_nvenc", 8)))
`;
    const r = spawnSync(PY, ["-c", PY_CODE_PREFIX + code], {
      encoding: "utf8",
    });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout.trim())).toBe(5);
  });

  it("uses BERU_FFPROBE when resolving the runtime ffprobe path", () => {
    const ffmpegProbe = path.join(os.tmpdir(), `beru-test-runtime-ffmpeg-${Date.now()}.bin`);
    const ffprobeProbe = path.join(os.tmpdir(), `beru-test-runtime-ffprobe-${Date.now()}.bin`);
    writeFileSync(ffmpegProbe, "");
    writeFileSync(ffprobeProbe, "");
    try {
      const r = spawnSync(
        PY,
        [
          "-c",
          PY_CODE_PREFIX +
            "import processor; print(processor.find_ffprobe(r'" +
            ffmpegProbe.replace(/\\/g, "\\\\") +
            "'))",
        ],
        {
          env: { ...process.env, BERU_FFPROBE: ffprobeProbe },
          encoding: "utf8",
        },
      );
      if (r.status !== 0) {
        console.error("STDOUT:", r.stdout);
        console.error("STDERR:", r.stderr);
      }
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe(ffprobeProbe);
    } finally {
      try {
        unlinkSync(ffmpegProbe);
      } catch {}
      try {
        unlinkSync(ffprobeProbe);
      } catch {}
    }
  });

  it("falls back to 'ffmpeg' / 'ffprobe' string when env vars are absent", () => {
    const env = { ...process.env };
    delete env.BERU_FFMPEG;
    delete env.BERU_FFPROBE;
    const r = spawnSync(
      PY,
      ["-c", PY_CODE_PREFIX + "import processor; print(processor.FFMPEG, processor.FFPROBE)"],
      { env, encoding: "utf8" },
    );
    if (r.status !== 0) {
      console.error("STDOUT:", r.stdout);
      console.error("STDERR:", r.stderr);
    }
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("ffmpeg ffprobe");
  });

  it("retries failed GPU jobs with fewer workers when BERU_RETRY_FAILED=1", () => {
    const code = `
import json
import os
import processor

calls = {"n": 0}

def fake_process(idx, job, ffmpeg_path):
    calls["n"] += 1
    job_id = job.get("id", idx)
    if calls["n"] <= 1:
        return {"index": job_id, "status": "failed", "error": "nvenc init failed"}
    return {"index": job_id, "status": "succeeded"}

processor.detect_hw_encoder = lambda _ffmpeg: "h264_nvenc"
processor.get_system_fonts = lambda: {}
processor._process_one = fake_process
os.environ["BERU_RETRY_FAILED"] = "1"
jobs = [{"id": 3, "input_path": "C:/tmp/a.mp4", "output_path": "C:/tmp/out.mp4"}]
result = processor.process_jobs(jobs, "ffmpeg", max_workers=4)
print(json.dumps({"calls": calls["n"], "result": result}))
`;
    const r = spawnSync(PY, ["-c", PY_CODE_PREFIX + code], {
      encoding: "utf8",
      timeout: 10000,
    });
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout.trim().split("\n").pop());
    expect(parsed.calls).toBe(2);
    expect(parsed.result.succeeded).toBe(1);
    expect(parsed.result.failed).toBe(0);
  });

  it("retries generic hardware filter failures with libx264", () => {
    const code = `
import json
import os
import tempfile
import processor

tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4")
tmp.close()
calls = []

def fake_run(cmd, timeout_sec=600, job_id=None, duration_sec=0.0):
    calls.append(cmd)
    if "libx264" in cmd:
        return True, None
    return False, "Error while filtering: Operation not permitted"

processor.detect_hw_encoder = lambda _ffmpeg: "h264_nvenc"
processor.get_system_fonts = lambda: {}
processor.job_video_info = lambda job, input_path: {
    "width": 320,
    "height": 180,
    "duration": 1.0,
    "pix_fmt": "yuv420p",
    "frame_rate": 24,
    "audio_codec": "aac",
    "audio_channels": 1,
    "video_codec": "h264",
}
processor._run_ffmpeg = fake_run
job = {
    "id": 2,
    "input_path": tmp.name,
    "output_path": tmp.name + ".out.mp4",
    "width": 320,
    "height": 180,
    "source_width": 320,
    "source_height": 180,
    "video_duration": 1,
    "operations": [{
        "mode": "text",
        "text": "Hola",
        "region": {"x": 10, "y": 10, "w": 120, "h": 40},
    }],
}
try:
    result = processor._process_one(0, job, "ffmpeg")
finally:
    os.unlink(tmp.name)
print(json.dumps({
    "result": result,
    "calls": len(calls),
    "second_uses_software": "libx264" in calls[1] if len(calls) > 1 else False,
}))
`;
    const r = spawnSync(PY, ["-c", PY_CODE_PREFIX + code], {
      encoding: "utf8",
      timeout: 10000,
    });
    if (r.status !== 0) {
      console.error("STDOUT:", r.stdout);
      console.error("STDERR:", r.stderr);
    }
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout.trim().split("\n").pop());
    expect(parsed.result.status).toBe("succeeded");
    expect(parsed.calls).toBe(2);
    expect(parsed.second_uses_software).toBe(true);
  });

  it("bounds stderr buffer while streaming progress", () => {
    const code = `
import processor
buf = []
for i in range(500):
    processor._stderr_buffer_append(buf, "x" * 200 + "\\n")
print(len(buf), sum(len(x) for x in buf))
`;
    const r = spawnSync(PY, ["-c", PY_CODE_PREFIX + code], { encoding: "utf8" });
    expect(r.status).toBe(0);
    const [lines, chars] = r.stdout.trim().split(" ").map(Number);
    expect(lines).toBeLessThanOrEqual(256);
    expect(chars).toBeLessThanOrEqual(48000);
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
