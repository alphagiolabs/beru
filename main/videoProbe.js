import { spawn } from "child_process";
import fs from "fs";

const DEFAULT_PIX_FMT = "yuv420p";

export function emptyVideoInfo(overrides = {}) {
  return {
    exists: true,
    width: 0,
    height: 0,
    duration: 0,
    videoCodec: "",
    pixFmt: DEFAULT_PIX_FMT,
    frameRate: 0,
    audioCodec: "",
    ...overrides,
  };
}

export function hasVideoDimensions(info) {
  return Number(info?.width || 0) > 0 && Number(info?.height || 0) > 0;
}

export function parseFrameRate(rateStr) {
  if (!rateStr) return 0;
  try {
    if (rateStr.includes("/")) {
      const [num, den] = rateStr.split("/");
      return den !== "0" ? parseFloat(num) / parseFloat(den) : 0;
    }
    return parseFloat(rateStr) || 0;
  } catch {
    return 0;
  }
}

export function parseFfprobeJson(stdout) {
  const info = JSON.parse(stdout);
  const streams = Array.isArray(info.streams) ? info.streams : [];
  const videoStream = streams.find((s) => s.codec_type === "video");
  const audioStream = streams.find((s) => s.codec_type === "audio");

  return emptyVideoInfo({
    width: videoStream ? Number(videoStream.width || 0) : 0,
    height: videoStream ? Number(videoStream.height || 0) : 0,
    duration: parseFloat(info.format?.duration) || 0,
    videoCodec: videoStream?.codec_name || "",
    pixFmt: videoStream?.pix_fmt || DEFAULT_PIX_FMT,
    frameRate: parseFrameRate(videoStream?.r_frame_rate || videoStream?.avg_frame_rate || ""),
    audioCodec: audioStream?.codec_name || "",
  });
}

function stripAnsi(text) {
  return String(text || "").replace(/\x1b\[[0-9;]*m/g, "");
}

function parseDuration(text) {
  const match = text.match(/Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/);
  if (!match) return 0;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

function parseStreamCodec(line, type) {
  const match = line.match(new RegExp(`${type}:\\s*([^,\\s(]+)`, "i"));
  return match?.[1] || "";
}

function parsePixFmt(videoLine, resolutionIndex) {
  const beforeResolution = videoLine.slice(0, Math.max(0, resolutionIndex));
  const parts = beforeResolution.split(",").map((part) => part.trim()).reverse();
  const pixFmt = parts.find((part) => /^[a-z][a-z0-9_]*(?:\([^)]+\))?$/i.test(part));
  return pixFmt ? pixFmt.replace(/\(.+\)$/, "") : DEFAULT_PIX_FMT;
}

export function parseFfmpegOutput(output) {
  const text = stripAnsi(output);
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const videoLine = lines.find((line) => /\bVideo:\s*/i.test(line)) || "";
  const audioLine = lines.find((line) => /\bAudio:\s*/i.test(line)) || "";
  const resolutionMatches = [...videoLine.matchAll(/(\d{2,6})x(\d{2,6})/g)];
  const resolution = resolutionMatches.find((m) => Number(m[1]) > 0 && Number(m[2]) > 0);
  const fpsMatch = videoLine.match(/,\s*([0-9]+(?:\.[0-9]+)?)\s*fps\b/i)
    || videoLine.match(/,\s*([0-9]+(?:\.[0-9]+)?)\s*tbr\b/i);

  return emptyVideoInfo({
    width: resolution ? Number(resolution[1]) : 0,
    height: resolution ? Number(resolution[2]) : 0,
    duration: parseDuration(text),
    videoCodec: parseStreamCodec(videoLine, "Video"),
    pixFmt: resolution ? parsePixFmt(videoLine, resolution.index) : DEFAULT_PIX_FMT,
    frameRate: fpsMatch ? Number(fpsMatch[1]) : 0,
    audioCodec: parseStreamCodec(audioLine, "Audio"),
  });
}

function runProcess(command, args, timeoutMs) {
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(command, args, { windowsHide: true });
    } catch (error) {
      resolve({ code: null, stdout: "", stderr: "", error });
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;
    let killTimer = null;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (killTimer) clearTimeout(killTimer);
      resolve({ stdout, stderr, ...result });
    };

    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("close", (code) => finish({ code }));
    proc.on("error", (error) => finish({ code: null, error }));
    killTimer = setTimeout(() => {
      try { proc.kill(); } catch {}
      finish({ code: null, timedOut: true });
    }, timeoutMs);
  });
}

export async function probeVideoFile(filePath, {
  ffprobePath,
  ffmpegPath,
  timeoutMs = 5000,
  allowFfmpegFallback = true,
} = {}) {
  if (!filePath || !fs.existsSync(filePath)) {
    return emptyVideoInfo({ exists: false });
  }

  let ffprobeInfo = null;
  if (ffprobePath && fs.existsSync(ffprobePath)) {
    const result = await runProcess(ffprobePath, [
      "-v", "quiet", "-print_format", "json",
      "-show_format", "-show_streams", filePath,
    ], timeoutMs);
    const raw = result.stdout.trim();
    if (raw) {
      try {
        ffprobeInfo = parseFfprobeJson(raw);
        if (hasVideoDimensions(ffprobeInfo)) return ffprobeInfo;
      } catch (e) {
        console.error("[beru] ffprobe JSON parse failed:", e.message);
      }
    }
  }

  if (allowFfmpegFallback && ffmpegPath && fs.existsSync(ffmpegPath)) {
    const result = await runProcess(ffmpegPath, [
      "-hide_banner", "-i", filePath,
    ], timeoutMs);
    const ffmpegInfo = parseFfmpegOutput(`${result.stdout}\n${result.stderr}`);
    if (hasVideoDimensions(ffmpegInfo)) {
      return {
        ...ffmpegInfo,
        duration: ffmpegInfo.duration || ffprobeInfo?.duration || 0,
        audioCodec: ffmpegInfo.audioCodec || ffprobeInfo?.audioCodec || "",
      };
    }
  }

  return ffprobeInfo || emptyVideoInfo();
}
