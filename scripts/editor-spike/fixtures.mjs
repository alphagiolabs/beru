import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ffmpegRun, ffprobeJson } from "./io.mjs";

const outDir = path.resolve(process.argv[2] ?? ".tmp/editor-f0/fixtures");
mkdirSync(outDir, { recursive: true });

const barcode = (block) =>
  String.raw`if(lt(Y\,${block})*lt(X\,${10 * block})\,255*mod(floor(N/pow(2\,floor(X/${block})))\,2)\,128)`;
const clickAudio = (seconds) =>
  String.raw`aevalsrc=0.1*sin(2*PI*440*t)+if(lt(mod(t\,1)\,0.005)\,0.8\,0):s=48000:d=${seconds}:c=stereo`;

const FIXTURES = [
  { name: "cfr-25", size: "640x360", rate: "25", seconds: 8, audio: true, block: 32 },
  { name: "cfr-30", size: "640x360", rate: "30", seconds: 8, audio: true, block: 32 },
  {
    name: "ntsc-30000-1001",
    size: "640x360",
    rate: "30000/1001",
    seconds: 8,
    audio: true,
    block: 32,
  },
  {
    name: "vfr-30-gaps",
    size: "640x360",
    rate: "30",
    seconds: 8,
    audio: false,
    block: 32,
    extraVf: "select=not(eq(mod(n\\,5)\\,2)+eq(mod(n\\,7)\\,4))",
    fpsMode: "passthrough",
  },
  {
    name: "vertical-rotated-90",
    size: "640x360",
    rate: "30",
    seconds: 8,
    audio: true,
    block: 32,
    rotate: 90,
  },
  { name: "no-audio-30", size: "640x360", rate: "30", seconds: 8, audio: false, block: 32 },
  {
    name: "prores-422-mov",
    size: "640x360",
    rate: "30",
    seconds: 8,
    audio: true,
    block: 32,
    codec: "prores",
    container: "mov",
  },
  {
    name: "hd-1080-30-detail-long-gop",
    size: "1920x1080",
    rate: "30",
    seconds: 12,
    audio: true,
    block: 64,
    gop: 360,
    texture: true,
  },
];

const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

const describe = (file) => {
  const info = ffprobeJson(file);
  const v = info.streams.find((s) => s.codec_type === "video");
  const a = info.streams.find((s) => s.codec_type === "audio");
  const rotation = v?.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? null;
  return {
    container: info.format.format_name,
    durationSec: Number(info.format.duration),
    sizeBytes: statSync(file).size,
    sha256: sha256(file),
    video: v && {
      codec: v.codec_name,
      width: v.width,
      height: v.height,
      pixFmt: v.pix_fmt,
      rFrameRate: v.r_frame_rate,
      avgFrameRate: v.avg_frame_rate,
      nbFrames: Number(v.nb_frames),
      rotation,
    },
    audio: a && { codec: a.codec_name, sampleRate: Number(a.sample_rate), channels: a.channels },
  };
};

const manifest = [];
for (const f of FIXTURES) {
  const container = f.container ?? "mp4";
  const file = path.join(outDir, `${f.name}.${container}`);
  const codecArgs =
    f.codec === "prores"
      ? ["-c:v", "prores_ks", "-profile:v", "2", "-pix_fmt", "yuv422p10le"]
      : [
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "18",
          "-pix_fmt",
          "yuv420p",
          "-g",
          String(f.gop ?? 30),
        ];
  const vf = f.texture ? ["noise=alls=12:allf=t"] : [`geq=lum='${barcode(f.block)}':cb=128:cr=128`];
  if (f.extraVf) vf.push(f.extraVf);
  const source = f.texture
    ? `testsrc2=size=${f.size}:rate=${f.rate}:duration=${f.seconds}`
    : `color=c=0x808080:s=${f.size}:r=${f.rate}:d=${f.seconds}`;
  const args = ["-f", "lavfi", "-i", source];
  if (f.audio) args.push("-f", "lavfi", "-i", clickAudio(f.seconds));
  args.push("-vf", vf.join(","), ...codecArgs);
  if (f.fpsMode) args.push("-fps_mode", f.fpsMode);
  if (f.audio) args.push("-c:a", "aac", "-b:a", "128k", "-shortest");
  else args.push("-an");
  args.push("-movflags", "+faststart", file);
  ffmpegRun(args);
  if (f.rotate) {
    const tmp = `${file}.rotated.${container}`;
    ffmpegRun([
      "-display_rotation",
      String(f.rotate),
      "-i",
      file,
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      tmp,
    ]);
    renameSync(tmp, file);
  }
  manifest.push({
    name: f.name,
    file: path.basename(file),
    requested: {
      size: f.size,
      rate: f.rate,
      seconds: f.seconds,
      audio: f.audio,
      rotate: f.rotate ?? 0,
    },
    ...describe(file),
  });
  console.log(`ok ${f.name}`);
}

const ffmpegVersion = execFileSync("ffmpeg", ["-version"], { encoding: "utf8" }).split("\n")[0];
writeFileSync(
  path.join(outDir, "manifest.json"),
  JSON.stringify(
    { generator: "scripts/editor-spike/fixtures.mjs", ffmpeg: ffmpegVersion, fixtures: manifest },
    null,
    2,
  ) + "\n",
);
console.log(`wrote ${manifest.length} fixtures to ${outDir}`);
