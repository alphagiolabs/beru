import fs from "node:fs";
import path from "node:path";
import { RUN_ROOT, ffmpeg } from "./harness.mjs";

export const FIXTURES = path.join(RUN_ROOT, "fixtures");

function encode(file, args) {
  if (fs.existsSync(file)) return file;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  ffmpeg([...args, "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", file]);
  return file;
}

export function basicFixtures() {
  const a = encode(path.join(FIXTURES, "a.mp4"), [
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=640x360:rate=30:duration=8",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=8",
    "-c:a",
    "aac",
    "-shortest",
  ]);
  const b = encode(path.join(FIXTURES, "b.mp4"), [
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=1280x720:rate=30:duration=5",
  ]);
  const corrupt = path.join(FIXTURES, "corrupt.mp4");
  if (!fs.existsSync(corrupt)) {
    fs.mkdirSync(FIXTURES, { recursive: true });
    fs.writeFileSync(corrupt, "esto no es un video: ".repeat(200));
  }
  return { a, b, corrupt };
}

export function longFixture() {
  return encode(path.join(FIXTURES, "long-60s.mp4"), [
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=1280x720:rate=30:duration=60",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=330:duration=60",
    "-c:a",
    "aac",
    "-shortest",
  ]);
}

export const CODEC_CLIPS = [
  { name: "h264.mp4", args: ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac"] },
  { name: "h264.mkv", args: ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac"] },
  {
    name: "vp9.webm",
    args: [
      "-c:v",
      "libvpx-vp9",
      "-b:v",
      "400k",
      "-deadline",
      "realtime",
      "-cpu-used",
      "8",
      "-c:a",
      "libopus",
    ],
  },
  {
    name: "hevc.mp4",
    args: [
      "-c:v",
      "libx265",
      "-pix_fmt",
      "yuv420p",
      "-tag:v",
      "hvc1",
      "-x265-params",
      "log-level=error",
      "-c:a",
      "aac",
    ],
  },
  {
    name: "av1.mp4",
    args: ["-c:v", "libaom-av1", "-b:v", "300k", "-cpu-used", "8", "-c:a", "aac"],
  },
  { name: "h264.mov", args: ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac"] },
  { name: "mpeg4.avi", args: ["-c:v", "mpeg4", "-q:v", "5", "-c:a", "pcm_s16le"] },
  { name: "h264.flv", args: ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac"] },
  { name: "wmv2.wmv", args: ["-c:v", "wmv2", "-b:v", "600k", "-c:a", "wmav2", "-b:a", "64k"] },
  {
    name: "mpeg2.mpg",
    args: ["-c:v", "mpeg2video", "-b:v", "800k", "-c:a", "mp2", "-b:a", "128k"],
  },
];

export function codecFixtures() {
  const dir = path.join(FIXTURES, "codecs");
  fs.mkdirSync(dir, { recursive: true });
  return CODEC_CLIPS.map(({ name, args }) => {
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) {
      ffmpeg([
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=320x180:rate=30:duration=3",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=3",
        ...args,
        "-shortest",
        file,
      ]);
    }
    return { name, file };
  });
}

export function blackFixture() {
  return encode(path.join(FIXTURES, "black-6s.mp4"), [
    "-f",
    "lavfi",
    "-i",
    "color=c=black:s=640x360:r=30:d=6",
  ]);
}

export function logoFixture() {
  const file = path.join(FIXTURES, "logo-red.png");
  if (!fs.existsSync(file)) {
    fs.mkdirSync(FIXTURES, { recursive: true });
    ffmpeg(["-f", "lavfi", "-i", "color=c=red:s=80x80", "-frames:v", "1", file]);
  }
  return file;
}
