import fs from "fs";
import { hasVideoDimensions } from "../shared/has-video-dimensions.js";
import { runCapturedProcess } from "./utils/run-captured.js";

const DEFAULT_PIX_FMT = "yuv420p";
const MAX_PROBE_STDOUT_BYTES = 1024 * 1024;
const MAX_PROBE_STDERR_BYTES = 256 * 1024;

function emptyVideoInfo(overrides = {}) {
  return {
    exists: true,
    width: 0,
    height: 0,
    duration: 0,
    videoCodec: "",
    pixFmt: DEFAULT_PIX_FMT,
    frameRate: 0,
    audioCodec: "",
    audioChannels: 0,
    ...overrides,
  };
}

function parseFrameRate(rateStr) {
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

function displayDimensions(width, height, rotation) {
  const degrees = Number(rotation) || 0;
  const turns = Math.round(degrees / 90);
  return Math.abs(degrees - turns * 90) < 1 && Math.abs(turns) % 2 === 1
    ? { width: height, height: width }
    : { width, height };
}

export function parseFfprobeJson(stdout) {
  const info = JSON.parse(stdout);
  const streams = Array.isArray(info.streams) ? info.streams : [];
  const videoStream = streams.find((s) => s.codec_type === "video");
  const audioStream = streams.find((s) => s.codec_type === "audio");
  const rotation =
    videoStream?.side_data_list?.find((data) => data.rotation != null)?.rotation ??
    videoStream?.tags?.rotate;

  return emptyVideoInfo({
    ...displayDimensions(
      Number(videoStream?.width || 0),
      Number(videoStream?.height || 0),
      rotation,
    ),
    duration: parseFloat(info.format?.duration) || 0,
    videoCodec: videoStream?.codec_name || "",
    pixFmt: videoStream?.pix_fmt || DEFAULT_PIX_FMT,
    frameRate: parseFrameRate(videoStream?.r_frame_rate || videoStream?.avg_frame_rate || ""),
    audioCodec: audioStream?.codec_name || "",
    audioChannels: audioStream ? Number(audioStream.channels || 0) : 0,
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
  const parts = beforeResolution
    .split(",")
    .map((part) => part.trim())
    .reverse();
  const pixFmt = parts.find((part) => /^[a-z][a-z0-9_]*(?:\([^)]+\))?$/i.test(part));
  return pixFmt ? pixFmt.replace(/\(.+\)$/, "") : DEFAULT_PIX_FMT;
}

export function parseFfmpegOutput(output) {
  const text = stripAnsi(output);
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const videoLine = lines.find((line) => /\bVideo:\s*/i.test(line)) || "";
  const audioLine = lines.find((line) => /\bAudio:\s*/i.test(line)) || "";
  const resolutionMatches = [...videoLine.matchAll(/(\d{2,6})x(\d{2,6})/g)];
  const resolution = resolutionMatches.find((m) => Number(m[1]) > 0 && Number(m[2]) > 0);
  const fpsMatch =
    videoLine.match(/,\s*([0-9]+(?:\.[0-9]+)?)\s*fps\b/i) ||
    videoLine.match(/,\s*([0-9]+(?:\.[0-9]+)?)\s*tbr\b/i);
  const channelLayoutMap = {
    mono: 1,
    "1.0": 1,
    stereo: 2,
    "2.0": 2,
    2.1: 3,
    "3.0": 3,
    "4.0": 4,
    3.1: 4,
    quad: 4,
    "5.0": 5,
    4.1: 5,
    5.1: 6,
    hexagonal: 6,
    6.1: 7,
    "7.0": 7,
    7.1: 8,
    octagonal: 8,
    "16.0": 16,
  };
  let audioChannels = 0;
  if (audioLine) {
    const layoutMatch = audioLine.match(/,\s*([a-z0-9.]+)\s*,\s*[a-z0-9]+/i);
    if (layoutMatch) {
      const key = layoutMatch[1].toLowerCase();
      if (key in channelLayoutMap) {
        audioChannels = channelLayoutMap[key];
      } else {
        const numMatch = key.match(/^(\d+)\.(\d+)$/);
        if (numMatch) audioChannels = Number(numMatch[1]) + Number(numMatch[2]);
      }
    }
  }

  return emptyVideoInfo({
    ...displayDimensions(
      resolution ? Number(resolution[1]) : 0,
      resolution ? Number(resolution[2]) : 0,
      text.match(/rotation of\s+([-\d.]+)\s+degrees/i)?.[1] ??
        text.match(/\brotate\s*:\s*([-\d.]+)/i)?.[1],
    ),
    duration: parseDuration(text),
    videoCodec: parseStreamCodec(videoLine, "Video"),
    pixFmt: resolution ? parsePixFmt(videoLine, resolution.index) : DEFAULT_PIX_FMT,
    frameRate: fpsMatch ? Number(fpsMatch[1]) : 0,
    audioCodec: parseStreamCodec(audioLine, "Audio"),
    audioChannels,
  });
}

function runProcess(command, args, timeoutMs) {
  return runCapturedProcess(command, args, {
    timeoutMs,
    maxStdoutBytes: MAX_PROBE_STDOUT_BYTES,
    maxStderrBytes: MAX_PROBE_STDERR_BYTES,
  });
}

export async function probeVideoFile(
  filePath,
  { ffprobePath, ffmpegPath, timeoutMs = 5000, allowFfmpegFallback = true } = {},
) {
  if (!filePath || !fs.existsSync(filePath)) {
    return emptyVideoInfo({ exists: false });
  }

  let ffprobeInfo = null;
  if (ffprobePath && fs.existsSync(ffprobePath)) {
    const result = await runProcess(
      ffprobePath,
      ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", filePath],
      timeoutMs,
    );
    const raw =
      result.outputExceeded || result.timedOut || result.error ? "" : result.stdout.trim();
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
    const result = await runProcess(ffmpegPath, ["-hide_banner", "-i", filePath], timeoutMs);
    const ffmpegInfo =
      result.outputExceeded || result.timedOut || result.error
        ? emptyVideoInfo()
        : parseFfmpegOutput(`${result.stdout}\n${result.stderr}`);
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
