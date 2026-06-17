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
  const PY_CODE_PREFIX =
    "import sys; sys.stdout.reconfigure(encoding='utf-8'); sys.path.insert(0, 'python'); ";

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

  it("uses an encoder-compatible preset when preflighting Intel Quick Sync", () => {
    const code = `
import json
import processor

captured = []

class Result:
    returncode = 0
    stderr = ""

def fake_run(cmd, **kwargs):
    captured.append(cmd)
    return Result()

processor.subprocess.run = fake_run
ok = processor._test_hw_encoder_real("ffmpeg", "h264_qsv")
print(json.dumps({"ok": ok, "cmd": captured[0]}))
`;
    const r = spawnSync(PY, ["-c", PY_CODE_PREFIX + code], {
      encoding: "utf8",
      timeout: 10000,
    });
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout.trim().split("\n").pop());
    expect(parsed.ok).toBe(true);
    expect(parsed.cmd[parsed.cmd.indexOf("-preset") + 1]).toBe("veryfast");
    expect(parsed.cmd).not.toContain("p1");
  });

  it("quotes Windows fontfile paths in drawtext filters", () => {
    const code = `
import processor
processor.get_system_fonts = lambda: {"arial": (r"C:\\Windows\\Fonts\\arial.ttf", "arial")}
_real_isfile = processor.os.path.isfile
processor.os.path.isfile = lambda p: True if "C:\\\\Windows\\\\Fonts" in p.replace("/", "\\\\") else _real_isfile(p)
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

  it("fills the full text region with drawbox when bg is enabled (matches CSS preview)", () => {
    const code = `
import processor
processor.get_system_fonts = lambda: {"arial": (r"C:\\\\Windows\\\\Fonts\\\\arial.ttf", "arial")}
graph, last, imgs = processor.build_filter_complex([
    {
        "mode": "text",
        "text": "OT  89898990",
        "font_family": "Arial",
        "bg_enabled": True,
        "bg_color": "black",
        "bg_opacity": 0.65,
        "box_border_width": 4,
        "safe_margin": 4,
        "region": {"x": 192, "y": 842, "w": 1536, "h": 130},
    },
], 1920, 1080)
print(graph)
`;
    const r = spawnSync(PY, ["-c", PY_CODE_PREFIX + code], { encoding: "utf8" });
    if (r.status !== 0) {
      console.error("STDOUT:", r.stdout);
      console.error("STDERR:", r.stderr);
    }
    expect(r.status).toBe(0);
    const graph = r.stdout.trim();
    expect(graph).toContain("drawbox=x=192:y=842:w=1536:h=130");
    expect(graph).toContain("color=black@0.650:t=fill");
    expect(graph).toContain("text='OT  89898990'");
    expect(graph).not.toContain("box=1");
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

  it("falls back to typographic spacing when drawtext has no spacing option", () => {
    const code = `
import processor
processor.get_system_fonts = lambda: {"arial": (r"C:\\\\Windows\\\\Fonts\\\\arial.ttf", "arial")}
processor._DRAWTEXT_OPTIONS_CACHE = set()
processor._DRAWTEXT_OPTIONS_CACHE_FOR = processor.FFMPEG
print(processor.build_drawtext({
    "mode": "text",
    "text": "ABC",
    "font_family": "Arial",
    "font_size": 48,
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
    expect(filter).not.toContain("spacing=");
    expect(filter).toContain("text='A\u200a\u200aB\u200a\u200aC'");
  });

  it("emits drawtext shadow options for text shadow styles", () => {
    const code = `
import processor
processor.get_system_fonts = lambda: {"arial": (r"C:\\\\Windows\\\\Fonts\\\\arial.ttf", "arial")}
print(processor.build_drawtext({
    "mode": "text",
    "text": "ABC",
    "font_family": "Arial",
    "text_shadow_enabled": True,
    "text_shadow_color": "#111111",
    "text_shadow_offset_x": 3,
    "text_shadow_offset_y": 4,
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
    expect(filter).toContain("shadowcolor=#111111");
    expect(filter).toContain("shadowx=3");
    expect(filter).toContain("shadowy=4");
  });

  it("omits unsupported drawtext options while preserving letter spacing", () => {
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
    expect(filter).toContain("text='A\u200a\u200a\u200aB\u200a\u200a\u200aC'");
    expect(filter).not.toContain("fontweight=");
    expect(filter).not.toContain("fontstyle=");
    expect(filter).not.toContain("spacing=");
  });

  it("uses the matching font file when weight and italic options are unsupported", () => {
    const code = `
import processor
processor.get_system_fonts = lambda: {
    "arial": (r"C:\\Windows\\Fonts\\arial.ttf", "arial"),
    "arial bold": (r"C:\\Windows\\Fonts\\arialbd.ttf", "arialbd"),
    "arial italic": (r"C:\\Windows\\Fonts\\ariali.ttf", "ariali"),
    "arial bold italic": (r"C:\\Windows\\Fonts\\arialbi.ttf", "arialbi"),
}
_real_isfile = processor.os.path.isfile
processor.os.path.isfile = lambda p: True if "C:\\\\Windows\\\\Fonts" in p.replace("/", "\\\\") else _real_isfile(p)
processor._DRAWTEXT_OPTIONS_CACHE = set()
processor._DRAWTEXT_OPTIONS_CACHE_FOR = processor.FFMPEG
print(processor.build_drawtext({
    "mode": "text",
    "text": "Styled",
    "font_family": "Arial",
    "font_size": 48,
    "font_weight": 700,
    "italic": True,
    "region": {"x": 10, "y": 20, "w": 300, "h": 80},
}))
`;
    const r = spawnSync(PY, ["-c", PY_CODE_PREFIX + code], { encoding: "utf8" });
    if (r.status !== 0) {
      console.error("STDOUT:", r.stdout);
      console.error("STDERR:", r.stderr);
    }
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toContain("fontfile='C\\:/Windows/Fonts/arialbi.ttf'");
  });

  it("conservative auto caps GPU at 2 and MF at 1", () => {
    const code = `
import json
import os
import processor
os.environ.pop("BERU_WORKERS", None)
os.environ["BERU_WORKERS_MODE"] = "conservative"
print(json.dumps([
    processor.resolve_max_workers("h264_nvenc", 4, consider_memory=False),
    processor.resolve_max_workers("h264_mf", 4, consider_memory=False),
    processor.resolve_max_workers(None, 1, consider_memory=False),
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
print(json.dumps(processor.resolve_max_workers("h264_nvenc", 8, consider_memory=False)))
`;
    const r = spawnSync(PY, ["-c", PY_CODE_PREFIX + code], {
      encoding: "utf8",
    });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout.trim())).toBe(5);
  });

  it("applies balanced GPU worker caps for 1080p quality batches with video filters", () => {
    const code = `
import json
import os
import processor
os.environ.pop("BERU_WORKERS", None)
os.environ["BERU_WORKERS_MODE"] = "balanced"
processor.os.cpu_count = lambda: 16
print(json.dumps({
    "filtered_quality": processor.resolve_max_workers(
        "h264_nvenc",
        8,
        1920 * 1080,
        consider_memory=False,
        has_video_filters=True,
        encode_profile="quality",
    ),
    "no_filters": processor.resolve_max_workers(
        "h264_nvenc",
        8,
        1920 * 1080,
        consider_memory=False,
        has_video_filters=False,
        encode_profile="quality",
    ),
    "software_filtered_quality": processor.resolve_max_workers(
        None,
        8,
        1920 * 1080,
        consider_memory=False,
        has_video_filters=True,
        encode_profile="quality",
    ),
    "filtered_uquality": processor.resolve_max_workers(
        "h264_nvenc",
        8,
        1920 * 1080,
        consider_memory=False,
        has_video_filters=True,
        encode_profile="uquality",
    ),
}))
`;
    const r = spawnSync(PY, ["-c", PY_CODE_PREFIX + code], {
      encoding: "utf8",
    });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout.trim())).toEqual({
      filtered_quality: 3,
      no_filters: 5,
      software_filtered_quality: 2,
      filtered_uquality: 2,
    });
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

def fake_process(idx, job, ffmpeg_path, **kwargs):
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

  it("retries memory-pressure batch failures sequentially", () => {
    const code = `
import json
import os
import processor

calls = []

def fake_process(idx, job, ffmpeg_path, **kwargs):
    workers = processor._BATCH_ACTIVE_WORKERS
    calls.append(workers)
    job_id = job.get("id", idx)
    if workers > 1:
        return {"index": job_id, "status": "failed", "error": "x264 [error]: malloc of size 11619264 failed"}
    return {"index": job_id, "status": "succeeded"}

processor.detect_hw_encoder = lambda _ffmpeg: "h264_nvenc"
processor.get_system_fonts = lambda: {}
processor._process_one = fake_process
os.environ["BERU_RETRY_FAILED"] = "1"
jobs = [
    {"id": i, "input_path": f"C:/tmp/{i}.mp4", "output_path": f"C:/tmp/out-{i}.mp4"}
    for i in range(4)
]
result = processor.process_jobs(jobs, "ffmpeg", max_workers=4)
print(json.dumps({"calls": calls, "result": result}))
`;
    const r = spawnSync(PY, ["-c", PY_CODE_PREFIX + code], {
      encoding: "utf8",
      timeout: 10000,
    });
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout.trim().split("\n").pop());
    expect(parsed.calls.slice(0, 4)).toEqual([4, 4, 4, 4]);
    expect(parsed.calls.slice(4)).toEqual([1, 1, 1, 1]);
    expect(parsed.result.succeeded).toBe(4);
    expect(parsed.result.failed).toBe(0);
  });

  it("never exceeds the requested active worker limit", () => {
    const code = `
import json
import threading
import time
import processor

active = {"n": 0, "max": 0}
lock = threading.Lock()

def fake_process(idx, job, ffmpeg_path, **kwargs):
    with lock:
        active["n"] += 1
        active["max"] = max(active["max"], active["n"])
    time.sleep(0.05)
    with lock:
        active["n"] -= 1
    return {"index": job.get("id", idx), "status": "succeeded"}

processor.detect_hw_encoder = lambda _ffmpeg: None
processor.get_system_fonts = lambda: {}
processor._process_one = fake_process
jobs = [{"id": i, "input_path": f"C:/tmp/{i}.mp4"} for i in range(8)]
result = processor.process_jobs(jobs, "ffmpeg", max_workers=2)
print(json.dumps({"max_active": active["max"], "result": result}))
`;
    const r = spawnSync(PY, ["-c", PY_CODE_PREFIX + code], {
      encoding: "utf8",
      timeout: 10000,
    });
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout.trim().split("\n").pop());
    expect(parsed.max_active).toBeLessThanOrEqual(2);
    expect(parsed.result.succeeded).toBe(8);
  });

  it("cancels a silent ffmpeg subprocess without waiting for output", () => {
    const code = `
import json
import sys
import threading
import time
import processor

processor._cancel_event.clear()

def trigger_cancel():
    time.sleep(0.2)
    processor._cancel_event.set()

threading.Thread(target=trigger_cancel, daemon=True).start()
started = time.perf_counter()
ok, err = processor._run_ffmpeg_stream(
    [sys.executable, "-c", "import time; time.sleep(1.5)"],
    timeout_sec=5,
    job_id=4,
    duration_sec=1.0,
)
elapsed = time.perf_counter() - started
processor._cancel_event.clear()
print(json.dumps({"ok": ok, "err": err, "elapsed": elapsed}))
`;
    const r = spawnSync(PY, ["-c", PY_CODE_PREFIX + code], {
      encoding: "utf8",
      timeout: 10000,
    });
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout.trim().split("\n").pop());
    expect(parsed.ok).toBe(false);
    expect(parsed.err).toContain("Cancelled");
    expect(parsed.elapsed).toBeLessThan(1.2);
  });

  it("removes partial outputs and keeps raw memory errors for retry logic", () => {
    const code = `
import json
import os
import tempfile
import processor

inp = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4")
inp.close()
out = inp.name + ".out.mp4"

def fake_run(cmd, timeout_sec=600, job_id=None, duration_sec=0.0):
    with open(out, "wb") as f:
        f.write(b"partial")
    return False, "x264 [error]: malloc of size 11619264 failed"

processor._run_ffmpeg = fake_run
processor._BATCH_ACTIVE_WORKERS = 4
job = {"id": 9, "input_path": inp.name, "output_path": out, "operations": []}
try:
    result = processor._process_one(0, job, "ffmpeg")
    exists_after = os.path.exists(out)
finally:
    os.unlink(inp.name)
    if os.path.exists(out):
        os.unlink(out)

print(json.dumps({"result": result, "exists_after": exists_after}))
`;
    const r = spawnSync(PY, ["-c", PY_CODE_PREFIX + code], {
      encoding: "utf8",
      timeout: 10000,
    });
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout.trim().split("\n").pop());
    expect(parsed.exists_after).toBe(false);
    expect(parsed.result.status).toBe("failed");
    expect(parsed.result.error).toContain("Memoria insuficiente");
    expect(parsed.result.raw_error).toContain("malloc");
  });

  it("bounds libx264 threads per active batch worker", () => {
    const code = `
import json
import processor

processor.os.cpu_count = lambda: 16
processor._BATCH_ACTIVE_WORKERS = 4
args = processor.build_encode_args("ffmpeg", "quality", {}, force_software=True)
threads_idx = args.index("-threads")
print(json.dumps({
    "threads": args[threads_idx + 1],
    "codec": args[args.index("-c:v") + 1],
    "crf": args[args.index("-crf") + 1],
    "args": args,
}))
`;
    const r = spawnSync(PY, ["-c", PY_CODE_PREFIX + code], {
      encoding: "utf8",
      timeout: 10000,
    });
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout.trim().split("\n").pop());
    expect(parsed.threads).toBe("4");
    expect(parsed.codec).toBe("libx264");
    expect(parsed.crf).toBe("18");
  });

  it("uses high-fidelity NVENC params for quality when hardware was preflighted", () => {
    const code = `
import json
import processor

processor.os.cpu_count = lambda: 16
processor._BATCH_ACTIVE_WORKERS = 2
args = processor.build_encode_args(
    "ffmpeg",
    "quality",
    {},
    hw_encoder="h264_nvenc",
)
print(json.dumps(args))
`;
    const r = spawnSync(PY, ["-c", PY_CODE_PREFIX + code], {
      encoding: "utf8",
      timeout: 10000,
    });
    expect(r.status).toBe(0);
    const args = JSON.parse(r.stdout.trim().split("\n").pop());
    expect(args).toContain("h264_nvenc");
    expect(args).not.toContain("libx264");
    expect(args[args.indexOf("-cq") + 1]).toBe("18");
    expect(args[args.indexOf("-preset") + 1]).toBe("p6");
  });

  it("keeps forced-software quality fallback on libx264 CRF 18", () => {
    const code = `
import json
import processor

processor.os.cpu_count = lambda: 16
processor._BATCH_ACTIVE_WORKERS = 2
args = processor.build_encode_args(
    "ffmpeg",
    "quality",
    {},
    force_software=True,
    hw_encoder="h264_nvenc",
)
print(json.dumps(args))
`;
    const r = spawnSync(PY, ["-c", PY_CODE_PREFIX + code], {
      encoding: "utf8",
      timeout: 10000,
    });
    expect(r.status).toBe(0);
    const args = JSON.parse(r.stdout.trim().split("\n").pop());
    expect(args).toContain("libx264");
    expect(args).not.toContain("h264_nvenc");
    expect(args[args.indexOf("-crf") + 1]).toBe("18");
    expect(args[args.indexOf("-preset") + 1]).toBe("medium");
  });

  it("uses optimized CPU high-fidelity params for U Quality even when hardware exists", () => {
    const code = `
import json
import processor

processor.os.cpu_count = lambda: 16
processor._BATCH_ACTIVE_WORKERS = 2
args = processor.build_encode_args(
    "ffmpeg",
    "uquality",
    {},
    hw_encoder="h264_nvenc",
)
print(json.dumps(args))
`;
    const r = spawnSync(PY, ["-c", PY_CODE_PREFIX + code], {
      encoding: "utf8",
      timeout: 10000,
    });
    expect(r.status).toBe(0);
    const args = JSON.parse(r.stdout.trim().split("\n").pop());
    expect(args).toContain("libx264");
    expect(args).not.toContain("h264_nvenc");
    expect(args[args.indexOf("-crf") + 1]).toBe("16");
    expect(args[args.indexOf("-preset") + 1]).toBe("faster");
  });

  it("uses AMF quality mode for the quality profile", () => {
    const code = `
import json
import processor

args = processor.build_encode_args(
    "ffmpeg",
    "quality",
    {},
    hw_encoder="h264_amf",
)
print(json.dumps(args))
`;
    const r = spawnSync(PY, ["-c", PY_CODE_PREFIX + code], {
      encoding: "utf8",
      timeout: 10000,
    });
    expect(r.status).toBe(0);
    const args = JSON.parse(r.stdout.trim().split("\n").pop());
    expect(args).toContain("h264_amf");
    expect(args[args.indexOf("-quality") + 1]).toBe("quality");
  });

  it("builds quality export commands without resize or framerate overrides", () => {
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
    return True, None

processor._run_ffmpeg = fake_run
processor.job_video_info = lambda job, input_path: {
    "width": 1920,
    "height": 1080,
    "duration": 1.0,
    "pix_fmt": "yuv420p",
    "frame_rate": 29.97,
    "audio_codec": "aac",
    "audio_channels": 2,
    "video_codec": "h264",
}
job = {
    "id": 4,
    "input_path": tmp.name,
    "output_path": tmp.name + ".out.mp4",
    "source_width": 1920,
    "source_height": 1080,
    "video_duration": 1.0,
    "pix_fmt": "yuv420p",
    "frame_rate": 29.97,
    "audio_codec": "aac",
    "audio_channels": 2,
    "encode_profile": "quality",
    "operations": [{
        "mode": "text",
        "text": "Hola",
        "region": {"x": 20, "y": 30, "w": 300, "h": 80},
    }],
}
try:
    result = processor._process_one(0, job, "ffmpeg", hw_encoder="h264_nvenc")
finally:
    os.unlink(tmp.name)

cmd = calls[0]
print(json.dumps({
    "status": result["status"],
    "uses_libx264": "libx264" in cmd,
    "uses_hw": "h264_nvenc" in cmd,
    "cq": cmd[cmd.index("-cq") + 1] if "-cq" in cmd else None,
    "preset": cmd[cmd.index("-preset") + 1] if "-preset" in cmd else None,
    "has_size_arg": "-s" in cmd or "-vf" in cmd,
    "has_rate_arg": "-r" in cmd,
    "pix_fmt": cmd[cmd.index("-pix_fmt") + 1],
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
    expect(parsed.status).toBe("succeeded");
    expect(parsed.uses_libx264).toBe(false);
    expect(parsed.uses_hw).toBe(true);
    expect(parsed.cq).toBe("18");
    expect(parsed.preset).toBe("p6");
    expect(parsed.has_size_arg).toBe(false);
    expect(parsed.has_rate_arg).toBe(false);
    expect(parsed.pix_fmt).toBe("yuv420p");
  });

  it("uses complete job video metadata without probing again", () => {
    const code = `
import json
import processor

def fail_probe(_path):
    raise AssertionError("ffprobe should not be called")

processor.ffprobe = fail_probe
info = processor.job_video_info({
    "width": 1920,
    "height": 1080,
    "source_width": 1920,
    "source_height": 1080,
    "video_duration": 12.5,
    "pix_fmt": "yuv420p",
    "frame_rate": 30,
    "audio_codec": "aac",
    "audio_channels": 2,
    "video_codec": "h264",
}, "C:/tmp/in.mp4")
print(json.dumps(info, sort_keys=True))
`;
    const r = spawnSync(PY, ["-c", PY_CODE_PREFIX + code], {
      encoding: "utf8",
      timeout: 10000,
    });
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout.trim().split("\n").pop());
    expect(parsed).toEqual({
      audio_channels: 2,
      audio_codec: "aac",
      duration: 12.5,
      frame_rate: 30,
      height: 1080,
      pix_fmt: "yuv420p",
      video_codec: "h264",
      width: 1920,
    });
  });

  it("probes when dimensions exist but timing metadata is missing", () => {
    const code = `
import json
import processor

calls = {"n": 0}

def fake_probe(_path):
    calls["n"] += 1
    return {
        "width": 640,
        "height": 360,
        "duration": 8.0,
        "pix_fmt": "yuv420p",
        "frame_rate": 24,
        "audio_codec": "aac",
        "audio_channels": 2,
        "video_codec": "h264",
    }

processor.ffprobe = fake_probe
info = processor.job_video_info({
    "width": 1920,
    "height": 1080,
    "source_width": 1920,
    "source_height": 1080,
}, "C:/tmp/in.mp4")
print(json.dumps({"calls": calls["n"], "info": info}, sort_keys=True))
`;
    const r = spawnSync(PY, ["-c", PY_CODE_PREFIX + code], {
      encoding: "utf8",
      timeout: 10000,
    });
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout.trim().split("\n").pop());
    expect(parsed.calls).toBe(1);
    expect(parsed.info.width).toBe(1920);
    expect(parsed.info.height).toBe(1080);
    expect(parsed.info.duration).toBe(8);
    expect(parsed.info.audio_codec).toBe("aac");
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
    "encode_profile": "quality",
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

  it("main passes the verified preflight encoder into process_jobs", () => {
    const code = `
import json
import os
import sys
import tempfile
import processor

fd, jobs_path = tempfile.mkstemp(suffix=".json")
os.close(fd)
ffmpeg = tempfile.NamedTemporaryFile(delete=False, suffix=".exe")
ffmpeg.close()
ffprobe = tempfile.NamedTemporaryFile(delete=False, suffix=".exe")
ffprobe.close()

seen = {}

def fake_process_jobs(jobs, ffmpeg_path, max_workers=None, *, hw_encoder=None):
    seen["jobs"] = jobs
    seen["ffmpeg_path"] = ffmpeg_path
    seen["hw_encoder"] = hw_encoder
    return {"total": len(jobs), "succeeded": len(jobs), "failed": 0}

try:
    with open(jobs_path, "w", encoding="utf-8") as f:
        json.dump([{"id": 0, "input_path": "C:/tmp/in.mp4", "output_path": "C:/tmp/out.mp4"}], f)
    processor.find_ffmpeg = lambda: ffmpeg.name
    processor.find_ffprobe = lambda _ffmpeg: ffprobe.name
    processor.detect_hw_encoder = lambda _ffmpeg, force_test=False: "h264_nvenc" if force_test else None
    processor.get_system_fonts = lambda: {}
    processor.process_jobs = fake_process_jobs
    sys.argv = ["processor.py", jobs_path]
    processor.main()
finally:
    os.unlink(jobs_path)
    os.unlink(ffmpeg.name)
    os.unlink(ffprobe.name)

print(json.dumps(seen))
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
    expect(parsed.hw_encoder).toBe("h264_nvenc");
    expect(parsed.jobs).toHaveLength(1);
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
processor._process_one = lambda idx, job, ffmpeg_path, **kwargs: {"index": job.get("id", idx), "status": "succeeded"}
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
