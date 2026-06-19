// Copies the static ffmpeg/ffprobe binaries from the ffmpeg-static and
// ffprobe-static packages into ./bin/ so the app can find them in dev and
// electron-builder can bundle them via extraResources.
//
// Idempotent: skips copy when the target already exists and is up-to-date.

import { existsSync, mkdirSync, copyFileSync, statSync } from "node:fs";
import { dirname, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const binDir = resolve(projectRoot, "bin");
const requireCJS = createRequire(import.meta.url);

const ffmpegStaticPkg = requireCJS("ffmpeg-static/package.json");
const ffprobeStaticPkg = requireCJS("ffprobe-static/package.json");
const ffmpegSource = requireCJS("ffmpeg-static");
const ffprobeModule = requireCJS("ffprobe-static");
const ffprobeSource = ffprobeModule?.path || ffprobeModule;

const ffmpegTarget = resolve(binDir, basename(ffmpegSource));
const ffprobeTarget = resolve(binDir, basename(ffprobeSource));

const ffmpegLicTarget = resolve(binDir, `${basename(ffmpegSource)}.LICENSE`);
const ffprobeLicTarget = resolve(binDir, `${basename(ffprobeSource)}.LICENSE`);

if (!existsSync(binDir)) mkdirSync(binDir, { recursive: true });

const needsCopy = (src, dst) => {
  if (!existsSync(src)) return true;
  if (!existsSync(dst)) return true;
  try {
    return statSync(src).mtimeMs > statSync(dst).mtimeMs;
  } catch {
    return true;
  }
};

let copied = 0;
let skipped = 0;

if (needsCopy(ffmpegSource, ffmpegTarget)) {
  copyFileSync(ffmpegSource, ffmpegTarget);
  console.log(`[ffmpeg] ${ffmpegSource} -> ${ffmpegTarget}`);
  copied += 1;
} else {
  skipped += 1;
}

if (needsCopy(ffprobeSource, ffprobeTarget)) {
  copyFileSync(ffprobeSource, ffprobeTarget);
  console.log(`[ffprobe] ${ffprobeSource} -> ${ffprobeTarget}`);
  copied += 1;
} else {
  skipped += 1;
}

const ffmpegLicSrc = resolve(dirname(ffmpegSource), `${basename(ffmpegSource)}.LICENSE`);
if (existsSync(ffmpegLicSrc) && needsCopy(ffmpegLicSrc, ffmpegLicTarget)) {
  copyFileSync(ffmpegLicSrc, ffmpegLicTarget);
}

const ffprobeLicSrc = resolve(dirname(ffprobeSource), `${basename(ffprobeSource)}.LICENSE`);
if (existsSync(ffprobeLicSrc) && needsCopy(ffprobeLicSrc, ffprobeLicTarget)) {
  copyFileSync(ffprobeLicSrc, ffprobeLicTarget);
}

console.log(
  `[ffmpeg] versions: ffmpeg-static@${ffmpegStaticPkg.version}, ffprobe-static@${ffprobeStaticPkg.version}`,
);
console.log(`[ffmpeg] ${copied} copied, ${skipped} up-to-date -> ${binDir}`);
