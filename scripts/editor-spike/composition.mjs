import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ffmpegRun, ffprobeJson, readBarcodes, readClickOnsets } from "./io.mjs";

const fixturesDir = path.resolve(process.argv[2] ?? ".tmp/editor-f0/fixtures");
const resultsDir = path.resolve(process.argv[3] ?? ".tmp/editor-f0/results");
const compDir = path.join(resultsDir, "compositions");
mkdirSync(compDir, { recursive: true });

const FPS = 30;
const SRC_W = 640;
const SRC_H = 360;
const BLOCK = 32;

const CASES = [
  {
    name: "cfr30-audio-then-cfr25-audio",
    w: 854,
    h: 480,
    barcode: true,
    clips: [
      { src: "cfr-30.mp4", in: 1, out: 6, audio: true, srcFps: 30 },
      { src: "cfr-25.mp4", in: 0, out: 5, audio: true, srcFps: 25 },
    ],
  },
  {
    name: "cfr30-audio-then-no-audio",
    w: 854,
    h: 480,
    barcode: true,
    clips: [
      { src: "cfr-30.mp4", in: 1, out: 6, audio: true, srcFps: 30 },
      { src: "no-audio-30.mp4", in: 0, out: 5, audio: false, srcFps: 30 },
    ],
  },
  {
    name: "hd1080-textured-two-clips",
    w: 1920,
    h: 1080,
    barcode: false,
    clips: [
      { src: "hd-1080-30-detail-long-gop.mp4", in: 1, out: 6, audio: true, srcFps: 30 },
      { src: "hd-1080-30-detail-long-gop.mp4", in: 0, out: 5, audio: true, srcFps: 30 },
    ],
  },
];

function buildGraph(clips, w, h) {
  const parts = [];
  const pairs = [];
  clips.forEach((c, i) => {
    const dur = c.out - c.in;
    parts.push(
      `[${i}:v]trim=start=${c.in}:end=${c.out},setpts=PTS-STARTPTS,fps=${FPS},` +
        `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,` +
        `setsar=1,format=yuv420p[v${i}]`,
    );
    if (c.audio) {
      parts.push(
        `[${i}:a]atrim=start=${c.in}:end=${c.out},asetpts=PTS-STARTPTS,` +
          `aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a${i}]`,
      );
    } else {
      parts.push(`anullsrc=sample_rate=48000:channel_layout=stereo,atrim=end=${dur}[a${i}]`);
    }
    pairs.push(`[v${i}][a${i}]`);
  });
  parts.push(`${pairs.join("")}concat=n=${clips.length}:v=1:a=1[vout][aout]`);
  return parts.join(";");
}

// Expected source frame for each output frame of one clip. The fps filter picks
// the nearest source frame to each output timestamp; exact half-frame ties go to
// the earlier frame (measured: a 25→30 conversion repeats frames 2,7,12,…).
// Integer arithmetic keeps exact ties exact: ceil(((in·FPS + j)·srcFps − FPS/2) / FPS).
function expectedSourceFrames(clip) {
  const count = Math.round((clip.out - clip.in) * FPS);
  return Array.from({ length: count }, (_, j) => {
    const numerator = 2 * (clip.in * FPS + j) * clip.srcFps - FPS;
    return Math.ceil(numerator / (2 * FPS));
  });
}

function expectedClicks(clips) {
  const times = [];
  let offset = 0;
  for (const c of clips) {
    if (c.audio) {
      for (let s = Math.ceil(c.in); s < c.out; s++) times.push(offset + (s - c.in));
    }
    offset += c.out - c.in;
  }
  return times;
}

function matchClicks(measured, expected) {
  const errors = expected.map((e) => {
    let best = null;
    for (const m of measured) if (best === null || Math.abs(m - e) < Math.abs(best - e)) best = m;
    return best === null ? null : (best - e) * 1000;
  });
  const matched = errors.filter((e) => e !== null && Math.abs(e) <= 100);
  return {
    expectedCount: expected.length,
    measuredCount: measured.length,
    matchedCount: matched.length,
    maxAbsErrorMs: matched.length ? Math.max(...matched.map(Math.abs)) : null,
    meanErrorMs: matched.length ? matched.reduce((a, b) => a + b, 0) / matched.length : null,
  };
}

const summarize = (probe) => {
  const v = probe.streams.find((s) => s.codec_type === "video");
  const a = probe.streams.find((s) => s.codec_type === "audio");
  return {
    durationSec: Number(probe.format.duration),
    video: {
      nbFrames: Number(v.nb_frames),
      rFrameRate: v.r_frame_rate,
      startTime: Number(v.start_time),
      width: v.width,
      height: v.height,
    },
    audio: a && {
      sampleRate: Number(a.sample_rate),
      channels: a.channels,
      startTime: Number(a.start_time),
      duration: Number(a.duration),
    },
  };
};

const results = [];
for (const c of CASES) {
  const outFile = path.join(compDir, `${c.name}.mp4`);
  const inputs = c.clips.flatMap((k) => ["-i", path.join(fixturesDir, k.src)]);
  const started = performance.now();
  ffmpegRun([
    ...inputs,
    "-filter_complex",
    buildGraph(c.clips, c.w, c.h),
    "-map",
    "[vout]",
    "-map",
    "[aout]",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(FPS),
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-movflags",
    "+faststart",
    outFile,
  ]);
  const renderMs = performance.now() - started;
  const output = summarize(ffprobeJson(outFile));
  const entry = {
    name: c.name,
    output: { ...output, width: c.w, height: c.h },
    renderMs: Math.round(renderMs),
    renderRealtimeFactor: round2(renderMs / 1000 / output.durationSec),
  };

  if (c.barcode) {
    const frames = readBarcodes(outFile, {
      bitWidth: (BLOCK * c.w) / SRC_W,
      height: (BLOCK * c.h) / SRC_H,
      bits: 10,
    });
    const perFrameMismatch = [];
    let offset = 0;
    c.clips.forEach((k, ci) => {
      expectedSourceFrames(k).forEach((e, j) => {
        const got = frames[offset + j];
        if (got !== e)
          perFrameMismatch.push({ clip: ci, outputFrame: offset + j, expected: e, got });
      });
      offset += expectedSourceFrames(k).length;
    });
    const expectedFrames = c.clips.flatMap((k) => expectedSourceFrames(k));
    const boundaryIdx = expectedSourceFrames(c.clips[0]).length;
    Object.assign(entry, {
      frames: {
        measured: frames.length,
        expected: expectedFrames.length,
        mismatches: perFrameMismatch.length,
        firstMismatches: perFrameMismatch.slice(0, 12),
      },
      boundary: {
        measured: { lastOfFirst: frames[boundaryIdx - 1], firstOfSecond: frames[boundaryIdx] },
        expected: {
          lastOfFirst: expectedFrames[boundaryIdx - 1],
          firstOfSecond: expectedFrames[boundaryIdx],
        },
      },
      clicks: matchClicks(readClickOnsets(outFile), expectedClicks(c.clips)),
    });
  }
  results.push(entry);
  const tail = c.barcode
    ? `frames ${entry.frames.measured}/${entry.frames.expected} mismatches ${entry.frames.mismatches}, clicks max ${entry.clicks.maxAbsErrorMs?.toFixed(2)} ms (${entry.clicks.matchedCount}/${entry.clicks.expectedCount})`
    : "no barcode check";
  console.log(
    `${c.name}: render ${entry.renderMs} ms for ${output.durationSec} s (x${entry.renderRealtimeFactor} realtime), ${tail}`,
  );
}

writeFileSync(
  path.join(resultsDir, "composition.json"),
  JSON.stringify({ fps: FPS, encode: "libx264 veryfast crf18 + aac 192k", results }, null, 2) +
    "\n",
);
console.log(`wrote ${path.join(resultsDir, "composition.json")}`);

function round2(x) {
  return Math.round(x * 100) / 100;
}
