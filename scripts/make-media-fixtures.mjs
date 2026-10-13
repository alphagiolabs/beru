#!/usr/bin/env node
// Synthetic, deterministic video fixtures for manual and automated checks.
// Output goes to .tmp/media-fixtures (gitignored). Never uses personal media.
//
//   node scripts/make-media-fixtures.mjs           generate fixtures and manifest.json
//   node scripts/make-media-fixtures.mjs --verify  regenerate elsewhere and compare hashes

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FFMPEG = path.join(ROOT, "bin", "ffmpeg.exe");
const FFPROBE = path.join(ROOT, "bin", "ffprobe.exe");
const OUT_DIR = path.join(ROOT, ".tmp", "media-fixtures");
const VERIFY_DIR = path.join(ROOT, ".tmp", "media-fixtures-verify");

const DETERMINISTIC = [
  "-hide_banner",
  "-loglevel",
  "error",
  "-y",
  "-fflags",
  "+bitexact",
  "-flags",
  "+bitexact",
  "-threads",
  "1",
];
const VIDEO_OUT = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p"];

function corners(w, h, size = 16) {
  return [
    `drawbox=x=0:y=0:w=${size}:h=${size}:color=red:t=fill`,
    `drawbox=x=${w - size}:y=0:w=${size}:h=${size}:color=lime:t=fill`,
    `drawbox=x=0:y=${h - size}:w=${size}:h=${size}:color=blue:t=fill`,
    `drawbox=x=${w - size}:y=${h - size}:w=${size}:h=${size}:color=yellow:t=fill`,
  ].join(",");
}

// `expect` values are checked against ffprobe after generation.
const FIXTURES = [
  {
    name: "corners-160x90.mp4",
    purpose: "Esquinas de color con geometría 160×90 y sin audio: giro, flip y crop.",
    args: [
      "-f",
      "lavfi",
      "-i",
      "color=c=0x202020:s=160x90:r=30:d=3",
      "-vf",
      corners(160, 90),
      ...VIDEO_OUT,
      "-an",
    ],
    expect: {
      width: 160,
      height: 90,
      rotation: 0,
      audio: false,
      duration: 3,
      corners: { tl: "red", tr: "lime", bl: "blue", br: "yellow" },
    },
  },
  {
    name: "rotated-meta-160x90.mp4",
    purpose: "Mismos píxeles 160×90 con metadata de giro de 90°: presentación 90×160.",
    // Stream copy of the corners fixture; the rotation is an input option of ffmpeg.
    args: ["-display_rotation:v:0", "90", "-i", "{dir}/corners-160x90.mp4", "-c", "copy", "-an"],
    expect: {
      width: 160,
      height: 90,
      rotation: 90,
      presentationWidth: 90,
      presentationHeight: 160,
      audio: false,
      duration: 3,
      rotatedCorners: true,
    },
  },
  {
    name: "tone-440-320x180.mp4",
    purpose: "Vídeo 320×180 con tono de 440 Hz estéreo a 48 kHz: volumen, mezcla y velocidad.",
    args: [
      "-f",
      "lavfi",
      "-i",
      "color=c=0x203040:s=320x180:r=30:d=4",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=48000:duration=4",
      "-filter_complex",
      "[1:a]pan=stereo|c0=c0|c1=c0[a]",
      "-map",
      "0:v",
      "-map",
      "[a]",
      ...VIDEO_OUT,
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-shortest",
    ],
    expect: { width: 320, height: 180, rotation: 0, audio: true, audioChannels: 2, duration: 4 },
  },
  {
    name: "noaudio-320x180.mp4",
    purpose: "Vídeo 320×180 sin pista de audio: la fuente sin audio debe seguir sin audio.",
    args: ["-f", "lavfi", "-i", "color=c=0x304020:s=320x180:r=30:d=4", ...VIDEO_OUT, "-an"],
    expect: { width: 320, height: 180, rotation: 0, audio: false, duration: 4 },
  },
  {
    name: "logos-640x360.mp4",
    purpose: "Dos marcas claras de 96×36 px en posiciones conocidas, para delogo y crop.",
    args: [
      "-f",
      "lavfi",
      "-i",
      "color=c=0x2a2a2a:s=640x360:r=30:d=5",
      "-vf",
      "drawbox=x=32:y=24:w=96:h=36:color=white:t=fill,drawbox=x=512:y=300:w=96:h=36:color=white:t=fill",
      ...VIDEO_OUT,
      "-an",
    ],
    expect: { width: 640, height: 360, rotation: 0, audio: false, duration: 5 },
  },
  {
    name: "testsrc2-1280x720.mp4",
    purpose:
      "Patrón con contador de tiempo 1280×720 para comprobar UI y tiempo en la reproducción.",
    args: ["-f", "lavfi", "-i", "testsrc2=s=1280x720:r=30:d=6", ...VIDEO_OUT, "-an"],
    expect: { width: 1280, height: 720, rotation: 0, audio: false, duration: 6 },
  },
];

const CORNER_RGB = {
  red: [255, 0, 0],
  lime: [0, 255, 0],
  blue: [0, 0, 255],
  yellow: [255, 255, 0],
};

// Autorotated first frame, sampled inside each colour box.
function sampleCorners(file, width, height) {
  const result = spawnSync(
    FFMPEG,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      file,
      "-frames:v",
      "1",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "pipe:1",
    ],
    { maxBuffer: 1 << 24 },
  );
  if (result.status !== 0) throw new Error(`sampling ${path.basename(file)} failed`);
  const pixel = (x, y) => {
    const i = (y * width + x) * 3;
    return [result.stdout[i], result.stdout[i + 1], result.stdout[i + 2]];
  };
  const nearest = ([r, g, b]) =>
    Object.keys(CORNER_RGB).reduce(
      (best, name) => {
        const [cr, cg, cb] = CORNER_RGB[name];
        const d = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
        return d < best.d ? { name, d } : best;
      },
      { name: null, d: Infinity },
    ).name;
  const inset = 6;
  return {
    tl: nearest(pixel(inset, inset)),
    tr: nearest(pixel(width - 1 - inset, inset)),
    bl: nearest(pixel(inset, height - 1 - inset)),
    br: nearest(pixel(width - 1 - inset, height - 1 - inset)),
  };
}

const sameCorners = (a, b) => ["tl", "tr", "bl", "br"].every((k) => a[k] === b[k]);
// Both 90° orientations of the unrotated layout (clockwise and counter-clockwise).
const ROTATED_LAYOUTS = [
  { tl: "blue", tr: "red", br: "lime", bl: "yellow" },
  { tl: "lime", tr: "yellow", br: "blue", bl: "red" },
];

const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

function run(binary, args) {
  const result = spawnSync(binary, args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(
      `${path.basename(binary)} failed (${result.status}): ${result.stderr || result.stdout}`,
    );
  }
  return result.stdout;
}

function probe(file) {
  const json = JSON.parse(
    run(FFPROBE, ["-v", "error", "-show_streams", "-show_format", "-of", "json", file]),
  );
  const video = json.streams.find((s) => s.codec_type === "video");
  const audio = json.streams.find((s) => s.codec_type === "audio");
  const rotation = video?.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? 0;
  const quarterTurn = Math.abs(rotation) % 180 === 90;
  return {
    presentation: quarterTurn ? [video.height, video.width] : [video.width, video.height],
    width: video.width,
    height: video.height,
    codec: video.codec_name,
    pixFmt: video.pix_fmt,
    frameRate: video.r_frame_rate,
    rotation,
    audio: audio
      ? { codec: audio.codec_name, channels: audio.channels, sampleRate: Number(audio.sample_rate) }
      : null,
    duration: Number(json.format.duration),
    sizeBytes: statSync(file).size,
  };
}

function checkExpectations(fixture, info) {
  const e = fixture.expect;
  const problems = [];
  if (info.width !== e.width || info.height !== e.height) {
    problems.push(`coded ${info.width}x${info.height}, expected ${e.width}x${e.height}`);
  }
  if (info.rotation !== e.rotation)
    problems.push(`rotation ${info.rotation}, expected ${e.rotation}`);
  if (e.presentationWidth) {
    const [pw, ph] =
      Math.abs(info.rotation) % 180 === 90 ? [info.height, info.width] : [info.width, info.height];
    if (pw !== e.presentationWidth || ph !== e.presentationHeight) {
      problems.push(
        `presentation ${pw}x${ph}, expected ${e.presentationWidth}x${e.presentationHeight}`,
      );
    }
  }
  if (Boolean(info.audio) !== e.audio)
    problems.push(`audio ${Boolean(info.audio)}, expected ${e.audio}`);
  if (e.audioChannels && info.audio?.channels !== e.audioChannels) {
    problems.push(`audio channels ${info.audio?.channels}, expected ${e.audioChannels}`);
  }
  if (e.corners && !sameCorners(info.corners, e.corners)) {
    problems.push(`corners ${JSON.stringify(info.corners)}, expected ${JSON.stringify(e.corners)}`);
  }
  if (e.rotatedCorners && !ROTATED_LAYOUTS.some((layout) => sameCorners(info.corners, layout))) {
    problems.push(`rotated corners ${JSON.stringify(info.corners)} match no 90° layout`);
  }
  if (Math.abs(info.duration - e.duration) > 0.05) {
    problems.push(`duration ${info.duration}, expected ${e.duration}`);
  }
  return problems;
}

function generate(outDir) {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const entries = [];
  for (const fixture of FIXTURES) {
    const file = path.join(outDir, fixture.name);
    const args = fixture.args.map((arg) => arg.replace("{dir}", outDir));
    run(FFMPEG, [
      ...DETERMINISTIC,
      ...args,
      "-map_metadata",
      "-1",
      "-movflags",
      "+faststart",
      file,
    ]);
    const info = probe(file);
    if (fixture.expect.corners || fixture.expect.rotatedCorners) {
      const [w, h] = info.presentation;
      info.corners = sampleCorners(file, w, h);
    }
    const problems = checkExpectations(fixture, info);
    if (problems.length) throw new Error(`${fixture.name}: ${problems.join("; ")}`);
    entries.push({ name: fixture.name, purpose: fixture.purpose, sha256: sha256(file), ...info });
  }
  return entries;
}

const verifyOnly = process.argv.includes("--verify");

if (verifyOnly) {
  const manifestPath = path.join(OUT_DIR, "manifest.json");
  if (!existsSync(manifestPath)) throw new Error("No manifest.json; run without --verify first.");
  const expected = JSON.parse(readFileSync(manifestPath, "utf8"));
  const regenerated = generate(VERIFY_DIR);
  const mismatches = regenerated.filter((entry, i) => entry.sha256 !== expected[i]?.sha256);
  rmSync(VERIFY_DIR, { recursive: true, force: true });
  if (mismatches.length) {
    console.error(`Non-deterministic fixtures: ${mismatches.map((m) => m.name).join(", ")}`);
    process.exit(1);
  }
  console.log(`media fixtures: ${regenerated.length} reproducible (sha256 match)`);
} else {
  const entries = generate(OUT_DIR);
  writeFileSync(path.join(OUT_DIR, "manifest.json"), `${JSON.stringify(entries, null, 2)}\n`);
  for (const entry of entries) {
    console.log(
      `${entry.name}  ${entry.width}x${entry.height}  ${entry.duration}s  ${entry.sha256.slice(0, 12)}`,
    );
  }
  console.log(`wrote ${entries.length} fixtures to ${path.relative(ROOT, OUT_DIR)}`);
}
