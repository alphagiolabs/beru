import { spawn } from "child_process";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { app } from "electron";
import { getFfmpegPath } from "./paths.js";

const pending = new Map();

function cacheDir() {
  return path.join(app.getPath("userData"), "preview-cache");
}

function isInsideDir(dir, target) {
  const rel = path.relative(dir, target);
  return rel === "" || (!!rel && !rel.startsWith("..") && !path.isAbsolute(rel));
}

function assertInsideDir(dir, target) {
  const resolvedDir = path.resolve(dir);
  const resolvedTarget = path.resolve(target);
  if (!isInsideDir(resolvedDir, resolvedTarget)) {
    throw new Error("Preview cache path outside sandbox");
  }
  return resolvedTarget;
}

function proxyPathFor(filePath, stat, dir = cacheDir()) {
  const key = `${filePath}|${stat.size}|${Math.floor(stat.mtimeMs)}`;
  const hash = crypto.createHash("sha1").update(key).digest("hex").slice(0, 20);
  return assertInsideDir(dir, path.join(dir, `${hash}.mp4`));
}

async function prunePreviewCache(dir) {
  try {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".mp4")) continue;
      const full = assertInsideDir(dir, path.join(dir, entry.name));
      const stat = await fs.promises.stat(full);
      files.push({ full, mtimeMs: stat.mtimeMs, size: stat.size });
    }
    files.sort((a, b) => b.mtimeMs - a.mtimeMs);
    const maxFiles = 24;
    const maxBytes = 2 * 1024 * 1024 * 1024;
    let bytes = 0;
    for (let i = 0; i < files.length; i++) {
      bytes += files[i].size;
      if (i >= maxFiles || bytes > maxBytes) {
        await fs.promises.unlink(files[i].full).catch(() => {});
      }
    }
  } catch {}
}

function transcodePreview(ffmpeg, inputPath, outputPath) {
  return new Promise((resolve) => {
    const tmpPath = assertInsideDir(path.dirname(outputPath), `${outputPath}.tmp`);
    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      inputPath,
      "-map",
      "0:v:0",
      "-an",
      "-sn",
      "-dn",
      "-vf",
      "scale=1280:-2:force_original_aspect_ratio=decrease",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "28",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      tmpPath,
    ];
    const proc = spawn(ffmpeg, args, { windowsHide: true });
    let stderr = "";
    proc.stderr.on("data", (d) => {
      stderr += d.toString();
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });
    proc.on("error", (err) => resolve({ ok: false, error: err.message }));
    proc.on("close", async (code) => {
      if (code !== 0) {
        await fs.promises.unlink(tmpPath).catch(() => {});
        return resolve({ ok: false, error: stderr.trim() || `FFmpeg exited with code ${code}` });
      }
      try {
        await fs.promises.rename(tmpPath, outputPath);
        resolve({ ok: true, path: outputPath });
      } catch (err) {
        resolve({ ok: false, error: err.message });
      }
    });
  });
}

export async function createPreviewProxy(filePath) {
  const ffmpeg = getFfmpegPath();
  if (!ffmpeg || !fs.existsSync(ffmpeg)) return { ok: false, error: "ffmpeg not found" };

  // Check the dedup map BEFORE any await. Two concurrent calls for the same
  // file would otherwise both pass the stat/mkdir awaits before either
  // registers a pending job, spawning two ffmpeg processes that race for the
  // same tmpPath and corrupt the cache.
  if (pending.has(filePath)) return pending.get(filePath);

  const stat = await fs.promises.stat(filePath);
  const dir = path.resolve(cacheDir());
  await fs.promises.mkdir(dir, { recursive: true });
  const outputPath = proxyPathFor(filePath, stat, dir);

  try {
    const existing = await fs.promises.stat(outputPath);
    if (existing.size > 0) return { ok: true, path: outputPath, cached: true };
  } catch {}

  // Re-check after the awaits in case a parallel call registered the same
  // job while we were awaiting.
  if (pending.has(filePath)) return pending.get(filePath);

  const job = transcodePreview(ffmpeg, filePath, outputPath).finally(() => {
    pending.delete(filePath);
    setTimeout(() => prunePreviewCache(dir), 0);
  });
  pending.set(filePath, job);
  return job;
}
