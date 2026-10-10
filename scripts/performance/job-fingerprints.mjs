import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

export function fingerprintJob(file, name, { ffmpeg, ffprobe, output }) {
  const info = JSON.parse(
    execFileSync(ffprobe, ["-v", "error", "-show_streams", "-show_format", "-of", "json", file], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 30000,
    }),
  );
  const hashes = [];
  for (const stream of info.streams.filter((s) => ["video", "audio"].includes(s.codec_type))) {
    const target = path.join(output, `${name}-${stream.codec_type}.framemd5`);
    execFileSync(
      ffmpeg,
      [
        "-v",
        "error",
        "-threads",
        "1",
        "-i",
        file,
        "-map",
        `0:${stream.index}`,
        ...(stream.codec_type === "audio" ? ["-c:a", "pcm_f32le"] : ["-c:v", "rawvideo"]),
        "-threads",
        "1",
        "-f",
        "framemd5",
        "-y",
        target,
      ],
      { windowsHide: true, timeout: 120000 },
    );
    hashes.push({
      type: stream.codec_type,
      sha256: createHash("sha256").update(fs.readFileSync(target)).digest("hex"),
      file: target,
    });
  }
  return { info, hashes };
}
