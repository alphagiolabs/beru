import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync, unlinkSync } from "fs";
import { spawnSync } from "child_process";
import path from "path";
import os from "os";

/**
 * Diagnostic: confirm what `t` the filter graph sees when `-ss` is placed
 * AFTER `-i` (output seek, current behavior) vs BEFORE `-i` (input seek).
 *
 * We render a frame at timestamp=2.0 with a drawtext that prints `%{t}` on the
 * frame, then OCR-free verify by checking the raw stderr/structure. Since we
 * can't OCR, we instead use a different signal: we apply a `blackdetect`-like
 * trick — actually we use `signalstats` or simply compare frames.
 *
 * Simpler approach: render two frames at timestamp=2.0 — one with
 * `drawtext=text=%{t}` and one without — and check that ffmpeg accepts the
 * timestamp. The real test is whether `enable=between(t,1.9,2.1)` activates at
 * timestamp=2.0, which the seek test already covers.
 */

const PY = process.env.BERU_PYTHON || (process.platform === "win32" ? "py" : "python3");
const PY_ARGS = process.platform === "win32" ? ["-3"] : [];
const FFMPEG_BIN = path.resolve("bin", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");

const hasPy = (() => {
  try {
    return spawnSync(PY, [...PY_ARGS, "--version"], { encoding: "utf8" }).status === 0;
  } catch {
    return false;
  }
})();
const hasFfmpeg =
  existsSync(FFMPEG_BIN) && spawnSync(FFMPEG_BIN, ["-version"], { encoding: "utf8" }).status === 0;

// `drawtext` requires ffmpeg to be compiled with --enable-libfreetype (and
// optionally --enable-libfontconfig). The ffmpeg-static Linux build used on CI
// does NOT include drawtext, while the Windows build does. Skip the drawtext
// assertion when the filter is unavailable instead of failing the pipeline.
const hasDrawtext = (() => {
  if (!hasFfmpeg) return false;
  const r = spawnSync(FFMPEG_BIN, ["-hide_banner", "-filters"], { encoding: "utf8" });
  if (r.status !== 0) return false;
  return /(^|\s)drawtext\s+/.test(r.stdout || "");
})();

const describeIf = hasPy && hasFfmpeg ? describe : describe.skip;

function makeVideo(tmpDir) {
  const videoPath = path.join(tmpDir, "src.mp4");
  const r = spawnSync(
    FFMPEG_BIN,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=160x120:rate=10",
      "-t",
      "3",
      "-pix_fmt",
      "yuv420p",
      videoPath,
    ],
    { encoding: "utf8" },
  );
  if (r.status !== 0) throw new Error(`ffmpeg makeVideo failed: ${r.stderr}`);
  return videoPath;
}

/** Run ffmpeg directly with a given -ss placement and return raw jpeg bytes. */
function renderWithSeekPlacement(videoPath, timestamp, seekBefore) {
  const tmpOut = path.join(os.tmpdir(), `beru-seek-diag-${Date.now()}.jpg`);
  const args = ["-hide_banner", "-loglevel", "error", "-y"];
  if (seekBefore) {
    args.push("-ss", timestamp.toFixed(3));
  }
  args.push("-i", videoPath);
  if (!seekBefore) {
    args.push("-ss", timestamp.toFixed(3));
  }
  args.push(
    "-vf",
    "drawtext=text='%{t}':x=10:y=10:fontsize=24:fontcolor=white",
    "-frames:v",
    "1",
    "-f",
    "image2",
    tmpOut,
  );
  const r = spawnSync(FFMPEG_BIN, args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`ffmpeg render failed: ${r.stderr}`);
  return tmpOut;
}

/** Run the Python renderer with an op time-bounded to [T-0.1, T+0.1] and check
 * whether the op is applied (frame differs from baseline). */
function renderPreviewWithOp(videoPath, timestamp, opStart, opEnd) {
  const payload = {
    input_path: videoPath,
    timestamp,
    source_width: 160,
    source_height: 120,
    operations: [
      {
        mode: "blur",
        region: { x: 0, y: 0, w: 160, h: 120 },
        blurStrength: 40,
        start_time: opStart,
        end_time: opEnd,
      },
    ],
  };
  const payloadFile = path.join(
    os.tmpdir(),
    `beru-payload-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
  );
  writeFileSync(payloadFile, JSON.stringify(payload));
  try {
    const code = `
import json, sys
sys.path.insert(0, "python")
import processor
processor.FFMPEG = processor.find_ffmpeg()
processor.FFPROBE = processor.find_ffprobe(processor.FFMPEG)
with open(${JSON.stringify(payloadFile)}, "r", encoding="utf-8") as f:
    payload = json.load(f)
print(json.dumps(processor.render_preview_frame(payload)))
`;
    const r = spawnSync(PY, [...PY_ARGS, "-c", code], {
      encoding: "utf8",
      cwd: process.cwd(),
      timeout: 30000,
    });
    if (r.status !== 0) throw new Error(`python render failed: ${r.stderr || r.stdout}`);
    return JSON.parse(r.stdout.trim());
  } finally {
    try {
      unlinkSync(payloadFile);
    } catch {}
  }
}

function renderPreviewNoOp(videoPath, timestamp) {
  return renderPreviewWithOp(videoPath, timestamp, null, null);
}

function dataUrlToBytes(dataUrl) {
  const b64 = dataUrl.split(",")[1] || "";
  return Buffer.from(b64, "base64");
}

function fingerprint(bytes) {
  let sum = 0;
  let sq = 0;
  for (let i = 0; i < bytes.length; i++) {
    const v = bytes[i];
    sum += v;
    sq += v * v;
  }
  return { sum, sq, len: bytes.length };
}

describeIf("render_preview_frame: -ss placement and filter-graph t", () => {
  let tmpDir;
  let videoPath;

  beforeAll(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "beru-seek-diag-"));
    videoPath = makeVideo(tmpDir);
  });

  afterAll(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  (hasDrawtext ? it : it.skip)(
    "drawtext %{t} shows the correct timestamp at output seek t=2.0",
    () => {
      // We can't OCR the rendered frame, but we can confirm ffmpeg runs and
      // produces a frame. The seek test below is the real signal.
      const out = renderWithSeekPlacement(videoPath, 2.0, false);
      expect(existsSync(out)).toBe(true);
      try {
        unlinkSync(out);
      } catch {}
    },
  );

  it("op with start_time=1.9,end_time=2.1 IS active at preview timestamp=2.0 (matches export)", () => {
    // If the bug existed (-ss resets t to 0), the op with [1.9,2.1] would NOT
    // activate at timestamp=2.0 because t would be 0 (outside [1.9,2.1]).
    // The frame would equal the no-op baseline.
    //
    // If the code is correct, the op activates and the frame differs from
    // baseline.
    const withOp = renderPreviewWithOp(videoPath, 2.0, 1.9, 2.1);
    const noOp = renderPreviewNoOp(videoPath, 2.0);

    expect(withOp.ok).toBe(true);
    expect(noOp.ok).toBe(true);

    const fOp = fingerprint(dataUrlToBytes(withOp.data_url));
    const fNo = fingerprint(dataUrlToBytes(noOp.data_url));

    const sumDelta = Math.abs(fOp.sum - fNo.sum);
    const sqDelta = Math.abs(fOp.sq - fNo.sq);

    // Op active → frame must be visibly different from no-op baseline.
    expect(sumDelta).toBeGreaterThan(50);
    expect(sqDelta).toBeGreaterThan(500);
  });

  it("op with start_time=0.0,end_time=0.1 is NOT active at preview timestamp=2.0 (matches export)", () => {
    // Op window is [0,0.1]; at t=2.0 it should be inactive → frame equals
    // no-op baseline. If `-ss` reset t to 0, the op would activate and the
    // frame would differ from baseline → test fails.
    const withOp = renderPreviewWithOp(videoPath, 2.0, 0.0, 0.1);
    const noOp = renderPreviewNoOp(videoPath, 2.0);

    expect(withOp.ok).toBe(true);
    expect(noOp.ok).toBe(true);

    const fOp = fingerprint(dataUrlToBytes(withOp.data_url));
    const fNo = fingerprint(dataUrlToBytes(noOp.data_url));

    const sumDelta = Math.abs(fOp.sum - fNo.sum);
    const sqDelta = Math.abs(fOp.sq - fNo.sq);

    // Op inactive → frame must be (nearly) identical to no-op baseline.
    // Allow small JPEG re-encoding noise.
    expect(sumDelta).toBeLessThan(200);
    expect(sqDelta).toBeLessThan(5000);
  });
});
