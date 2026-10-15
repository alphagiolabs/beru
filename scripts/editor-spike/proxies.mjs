import { mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ffmpegRun, ffprobeJson } from "./io.mjs";

const fixturesDir = path.resolve(process.argv[2] ?? ".tmp/editor-f0/fixtures");
const proxiesDir = path.resolve(process.argv[3] ?? ".tmp/editor-f0/proxies");
mkdirSync(proxiesDir, { recursive: true });

const HD = "hd-1080-30-detail-long-gop.mp4";
const CANDIDATES = [
  { name: "p540-gop15", source: HD, height: 540, gop: 15 },
  { name: "p540-intra", source: HD, height: 540, gop: 1 },
  { name: "p720-gop30", source: HD, height: 720, gop: 30 },
  { name: "p540-gop15-from-prores", source: "prores-422-mov.mov", height: 540, gop: 15 },
];

const results = [];
for (const c of CANDIDATES) {
  const input = path.join(fixturesDir, c.source);
  const output = path.join(proxiesDir, `${c.name}.mp4`);
  const started = performance.now();
  ffmpegRun([
    "-i",
    input,
    "-vf",
    `scale=-2:min(${c.height}\\,ih),format=yuv420p`,
    "-r",
    "30",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-g",
    String(c.gop),
    "-keyint_min",
    String(c.gop),
    "-sc_threshold",
    "0",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-ac",
    "2",
    "-ar",
    "48000",
    "-movflags",
    "+faststart",
    output,
  ]);
  const encodeMs = performance.now() - started;
  const probe = ffprobeJson(output);
  const v = probe.streams.find((s) => s.codec_type === "video");
  results.push({
    name: c.name,
    source: c.source,
    targetHeight: c.height,
    gop: c.gop,
    file: path.relative(process.cwd(), output),
    encodeWallMs: Math.round(encodeMs),
    sizeBytes: statSync(output).size,
    sizeBytesPerSecond: Math.round(statSync(output).size / Number(probe.format.duration)),
    width: v.width,
    height: v.height,
    durationSec: Number(probe.format.duration),
    rFrameRate: v.r_frame_rate,
  });
  console.log(
    `${c.name}: ${v.width}x${v.height}, ${Math.round(encodeMs)} ms, ${statSync(output).size} bytes`,
  );
}

writeFileSync(
  path.join(proxiesDir, "proxies.json"),
  JSON.stringify({ candidates: results }, null, 2) + "\n",
);
