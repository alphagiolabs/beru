import { execFileSync, spawnSync } from "node:child_process";

const LARGE = 1024 * 1024 * 1024;

export const ffmpegRun = (args) =>
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], {
    stdio: ["ignore", "ignore", "inherit"],
  });

export const ffprobeJson = (file) =>
  JSON.parse(
    execFileSync(
      "ffprobe",
      ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", file],
      { encoding: "utf8" },
    ),
  );

export function readBarcodes(file, { bitWidth, height, bits = 10 }) {
  const cropW = Math.ceil(bits * bitWidth);
  const cropH = Math.ceil(height);
  const run = spawnSync(
    "ffmpeg",
    // format=gray before crop: cropping yuv420p rounds odd widths to even and breaks the row stride.
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      file,
      "-vf",
      `format=gray,crop=${cropW}:${cropH}:0:0`,
      "-f",
      "rawvideo",
      "-",
    ],
    { maxBuffer: LARGE },
  );
  if (run.status !== 0) throw new Error(`barcode decode failed for ${file}: ${run.stderr}`);
  const frameBytes = cropW * cropH;
  const midY = Math.floor(cropH / 2);
  const indices = [];
  for (let off = 0; off + frameBytes <= run.stdout.length; off += frameBytes) {
    let value = 0;
    for (let i = 0; i < bits; i++) {
      const x = Math.floor((i + 0.5) * bitWidth);
      if (run.stdout[off + midY * cropW + x] > 128) value |= 1 << i;
    }
    indices.push(value);
  }
  return indices;
}

export function readClickOnsets(file, { rate = 48000, threshold = 0.5 } = {}) {
  const run = spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      file,
      "-vn",
      "-ac",
      "1",
      "-ar",
      String(rate),
      "-f",
      "s16le",
      "-",
    ],
    { maxBuffer: LARGE },
  );
  if (run.status !== 0) throw new Error(`audio decode failed for ${file}: ${run.stderr}`);
  const pcm = new Int16Array(
    run.stdout.buffer.slice(run.stdout.byteOffset, run.stdout.byteOffset + run.stdout.length),
  );
  const limit = threshold * 32767;
  const onsets = [];
  let previous = 0;
  for (let i = 0; i < pcm.length; i++) {
    if (Math.abs(pcm[i]) >= limit && Math.abs(previous) < limit) onsets.push(i / rate);
    previous = pcm[i];
  }
  return onsets;
}
