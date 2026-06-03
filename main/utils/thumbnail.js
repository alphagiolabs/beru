import { spawn } from "child_process";
import fs from "fs";
import { getFfmpegPath } from "./paths.js";

export function extractThumbnail(filePath, width = 80) {
  return new Promise((resolve) => {
    const ffmpeg = getFfmpegPath();
    if (!fs.existsSync(ffmpeg) || !fs.existsSync(filePath)) return resolve(null);
    const chunks = [];
    let settled = false;
    let killTimer = null;
    const proc = spawn(ffmpeg, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      "1",
      "-i",
      filePath,
      "-an",
      "-sn",
      "-dn",
      "-vframes",
      "1",
      "-vf",
      `scale=${width}:-2`,
      "-q:v",
      "10",
      "-f",
      "image2pipe",
      "-vcodec",
      "mjpeg",
      "-",
    ]);
    const finish = (data) => {
      if (settled) return;
      settled = true;
      if (killTimer) clearTimeout(killTimer);
      try {
        proc.kill();
      } catch {}
      resolve(data);
    };
    proc.stdout.on("data", (d) => chunks.push(d));
    proc.stderr.on("data", () => {}); // ignore
    proc.on("error", () => finish(null));
    proc.on("close", (code) => {
      if (code !== 0) return finish(null);
      const buf = Buffer.concat(chunks);
      if (buf.length < 64) return finish(null);
      const dataUrl = `data:image/jpeg;base64,${buf.toString("base64")}`;
      finish({ dataUrl, size: buf.length });
    });
    killTimer = setTimeout(() => finish(null), 5000);
  });
}
