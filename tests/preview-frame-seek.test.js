import { describe, it, expect, beforeAll } from "vitest";
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PY = process.env.BERU_PYTHON || "py";

const W = 160;
const H = 120;
const FPS = 10;
const DUR = 3;
const T = 2.0;

const FFMPEG =
  process.env.BERU_FFMPEG ||
  ["bin/ffmpeg.exe", "bin/ffmpeg"].map((p) => path.join(ROOT, p)).find((p) => fs.existsSync(p)) ||
  "ffmpeg";

let videoPath;

function makeVideo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "beru-preview-seek-"));
  const out = path.join(dir, "src.mp4");
  const r = spawnSync(
    FFMPEG,
    [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      `testsrc2=s=${W}x${H}:r=${FPS}:d=${DUR}`,
      "-vf",
      "drawbox=x=10:y=10:w=60:h=40:color=white:t=fill",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      out,
    ],
    { timeout: 30000 },
  );
  if (r.status !== 0) throw new Error(`ffmpeg fixture failed: ${r.stderr?.toString()}`);
  return out;
}

function runPy(code) {
  const r = spawnSync(PY, ["-3", "-c", code], {
    cwd: ROOT,
    encoding: "utf-8",
    timeout: 60000,
  });
  if (r.status !== 0) {
    throw new Error(`python failed: ${r.stderr?.toString().slice(-400)}`);
  }
  return r.stdout.trim();
}

function decodeJpegToRgb(jpegB64) {
  const r = spawnSync(
    FFMPEG,
    [
      "-v",
      "error",
      "-f",
      "image2pipe",
      "-i",
      "pipe:0",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "pipe:1",
    ],
    { input: Buffer.from(jpegB64, "base64"), timeout: 30000, encoding: "buffer" },
  );
  if (r.status !== 0) throw new Error("jpeg decode failed");
  return r.stdout;
}

function renderPreviewRgb(ts, operations) {
  const out = runPy(`
import sys, json
sys.path.insert(0, r"${path.join(ROOT, "python")}")
import processor
processor.FFMPEG = processor.find_ffmpeg()
processor.FFPROBE = processor.find_ffprobe(processor.FFMPEG)
res = processor.render_preview_frame({
    "input_path": r"${videoPath}",
    "width": ${W}, "height": ${H},
    "timestamp": ${ts},
    "operations": ${JSON.stringify(operations)},
    "asset_roots": [r"${path.dirname(videoPath)}"],
})
assert res["ok"], res.get("error")
print(res["data_url"].split(",", 1)[1])
`);
  return decodeJpegToRgb(out);
}

function renderExportRgb(ts, operations) {
  const b64 = runPy(`
import sys, base64, subprocess
sys.path.insert(0, r"${path.join(ROOT, "python")}")
import processor
processor.FFMPEG = processor.find_ffmpeg()
ops = [processor._normalize_operation(o) for o in ${JSON.stringify(operations)}]
graph, label, imgs = processor.build_filter_complex(ops, ${W}, ${H})
cmd = [processor.FFMPEG, "-v", "error", "-i", r"${videoPath}"]
for p in imgs:
    cmd += ["-loop", "1", "-t", "3", "-i", p]
if graph:
    cmd += ["-filter_complex", graph, "-map", label]
else:
    cmd += ["-map", "0:v:0"]
cmd += ["-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"]
raw = subprocess.run(cmd, capture_output=True, check=True).stdout
size = ${W} * ${H} * 3
idx = int(round(${ts} * ${FPS}))
sys.stdout.write(base64.b64encode(raw[idx*size:(idx+1)*size]).decode())
`);
  return Buffer.from(b64, "base64");
}

function meanAbsErr(a, b) {
  let sum = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) sum += Math.abs(a[i] - b[i]);
  return sum / n;
}

function regionMeanAbsErr(a, b, x0, y0, w, h) {
  let sum = 0;
  let n = 0;
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const i = (y * W + x) * 3;
      sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
      n += 3;
    }
  }
  return sum / n;
}

const fillOp = (start_time, end_time) => [
  {
    mode: "delogo",
    delogo_method: "fill",
    delogo_fill_color: "red",
    delogo_fill_opacity: 1,
    edge_feather: 0,
    region: { x: 10, y: 10, w: 60, h: 40 },
    start_time,
    end_time,
  },
];
const FILL_BOX = [10, 10, 60, 40];

describe("preview frame seek parity (real ffmpeg, decoded pixels)", () => {
  beforeAll(() => {
    videoPath = makeVideo();
  }, 60000);

  it("no-op preview (zero operations) equals the raw export frame", { timeout: 60000 }, () => {
    const preview = renderPreviewRgb(T, []);
    const exported = renderExportRgb(T, []);
    expect(meanAbsErr(preview, exported)).toBeLessThanOrEqual(4);
  });

  it(
    "op active at t=2.0 fires in preview exactly like the export frame",
    { timeout: 120000 },
    () => {
      const ops = fillOp(1.9, 2.1);
      const preview = renderPreviewRgb(T, ops);
      const exported = renderExportRgb(T, ops);
      const noop = renderPreviewRgb(T, []);
      expect(meanAbsErr(preview, exported)).toBeLessThanOrEqual(6);
      expect(regionMeanAbsErr(preview, noop, ...FILL_BOX)).toBeGreaterThan(20);
    },
  );

  it(
    "op inactive at t=2.0 stays invisible in preview like the export frame",
    { timeout: 120000 },
    () => {
      const ops = fillOp(0.0, 0.5);
      const preview = renderPreviewRgb(T, ops);
      const exported = renderExportRgb(T, ops);
      const noop = renderPreviewRgb(T, []);
      expect(meanAbsErr(preview, exported)).toBeLessThanOrEqual(4);
      expect(meanAbsErr(preview, noop)).toBeLessThanOrEqual(4);
    },
  );

  it(
    "start boundary: op from t=2.0 is active on the export frame at t=2.0",
    { timeout: 120000 },
    () => {
      const ops = fillOp(2.0, 2.6);
      const preview = renderPreviewRgb(T, ops);
      const exported = renderExportRgb(T, ops);
      expect(meanAbsErr(preview, exported)).toBeLessThanOrEqual(6);
      expect(regionMeanAbsErr(preview, renderPreviewRgb(T, []), ...FILL_BOX)).toBeGreaterThan(20);
    },
  );

  it(
    "end boundary: op until t=2.0 is still active on the export frame at t=2.0",
    { timeout: 120000 },
    () => {
      const ops = fillOp(1.4, 2.0);
      const preview = renderPreviewRgb(T, ops);
      const exported = renderExportRgb(T, ops);
      expect(meanAbsErr(preview, exported)).toBeLessThanOrEqual(6);
      expect(regionMeanAbsErr(preview, renderPreviewRgb(T, []), ...FILL_BOX)).toBeGreaterThan(20);
    },
  );

  it("past the window end the op is gone in both preview and export", { timeout: 120000 }, () => {
    const ops = fillOp(0.5, 1.5);
    const preview = renderPreviewRgb(T, ops);
    const exported = renderExportRgb(T, ops);
    const noop = renderPreviewRgb(T, []);
    expect(meanAbsErr(preview, exported)).toBeLessThanOrEqual(4);
    expect(meanAbsErr(preview, noop)).toBeLessThanOrEqual(4);
  });

  it("uses the last frame when previewing at the video end", { timeout: 60000 }, () => {
    const output = JSON.parse(
      runPy(`
import sys, json
sys.path.insert(0, r"${path.join(ROOT, "python")}")
import processor
processor.FFMPEG = processor.find_ffmpeg()
processor.FFPROBE = processor.find_ffprobe(processor.FFMPEG)
payload = {"input_path": r"${videoPath}", "width": ${W}, "height": ${H}, "video_duration": ${DUR}, "frame_rate": ${FPS}, "operations": []}
result = {}
for name, render in (("preview", processor.render_preview_frame), ("source", processor.render_source_frame)):
    result[name] = [render({**payload, "timestamp": ts}) for ts in (${DUR - 1 / FPS}, ${DUR - 0.05}, ${DUR})]
    result[name].append(render({**payload, "frame_rate": 0, "timestamp": ${DUR}}))
print(json.dumps(result))
`),
    );

    for (const frames of Object.values(output)) {
      expect(frames.map((frame) => frame.error)).toEqual([
        undefined,
        undefined,
        undefined,
        undefined,
      ]);
      expect(frames.every((frame) => frame.ok)).toBe(true);
      const lastFrame = decodeJpegToRgb(frames[0].data_url.split(",")[1]);
      for (const frame of frames.slice(1)) {
        expect(meanAbsErr(decodeJpegToRgb(frame.data_url.split(",")[1]), lastFrame)).toBeLessThan(
          4,
        );
      }
    }

    const lastFrameWithOp = renderPreviewRgb(DUR - 1 / FPS, fillOp(DUR - 1 / FPS, DUR));
    const endWithOp = renderPreviewRgb(DUR, fillOp(DUR - 1 / FPS, DUR));
    expect(meanAbsErr(endWithOp, lastFrameWithOp)).toBeLessThan(4);
  });

  it("uses the last video frame when audio continues after video", { timeout: 60000 }, () => {
    const source = path.join(path.dirname(videoPath), "audio-longer.mp4");
    const mux = spawnSync(
      FFMPEG,
      [
        "-v",
        "error",
        "-y",
        "-i",
        videoPath,
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=6",
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        source,
      ],
      { timeout: 30000 },
    );
    expect(mux.status).toBe(0);

    const output = JSON.parse(
      runPy(`
import json, sys
sys.path.insert(0, r"${path.join(ROOT, "python")}")
import processor
processor.FFMPEG = processor.find_ffmpeg()
processor.FFPROBE = processor.find_ffprobe(processor.FFMPEG)
source = r"${source}"
payload = {"input_path": source, "source_width": ${W}, "source_height": ${H}, "video_duration": 6, "frame_rate": ${FPS}, "operations": []}
result = {}
for name, render in (("preview", processor.render_preview_frame), ("source", processor.render_source_frame)):
    result[name] = [render({**payload, "timestamp": ts}) for ts in (${DUR - 1 / FPS}, 5.9)]
payload["operations"] = ${JSON.stringify(fillOp(DUR - 1 / FPS, DUR))}
result["filtered"] = [processor.render_preview_frame({**payload, "timestamp": ts}) for ts in (${DUR - 1 / FPS}, 5.9)]
print(json.dumps(result))
`),
    );

    for (const frames of Object.values(output)) {
      expect(frames.map((frame) => frame.error)).toEqual([undefined, undefined]);
      const lastFrame = decodeJpegToRgb(frames[0].data_url.split(",")[1]);
      const audioTailFrame = decodeJpegToRgb(frames[1].data_url.split(",")[1]);
      expect(meanAbsErr(audioTailFrame, lastFrame)).toBeLessThan(4);
    }
    const filtered = decodeJpegToRgb(output.filtered[0].data_url.split(",")[1]);
    const unfiltered = decodeJpegToRgb(output.preview[0].data_url.split(",")[1]);
    expect(regionMeanAbsErr(filtered, unfiltered, ...FILL_BOX)).toBeGreaterThan(20);
  });
});
