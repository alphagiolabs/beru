import os from "os";
import {
  normalizeEncodeProfile,
  profileAllowsHardware,
  getEffectiveHwEncoder,
} from "./encodeProfiles.js";

export const MAX_BATCH_WORKERS = 16;
export const AUTO_TARGET_WORKERS = 5;

const ENCODER_CAPS = {
  conservative: {
    h264_mf: 1,
    h264_nvenc: 2,
    h264_qsv: 2,
    h264_amf: 2,
    h264_vaapi: 2,
    h264_videotoolbox: 2,
  },
  balanced: {
    h264_mf: 1,
    h264_nvenc: 5,
    h264_qsv: 5,
    h264_amf: 4,
    h264_vaapi: 4,
    h264_videotoolbox: 4,
  },
};

/**
 * Mirror of python/processor.resolve_max_workers for UI hints (no env override).
 */
export function resolveBatchWorkers({
  hwEncoder = null,
  jobCount = 1,
  maxSourcePixels = 0,
  mode = "balanced",
  explicitWorkers = 0,
  hasVideoFilters = false,
  encodeProfile = "balanced",
}) {
  const jobs = Math.max(1, Math.floor(Number(jobCount) || 1));
  const explicit = Math.floor(Number(explicitWorkers) || 0);
  if (explicit > 0) {
    return Math.max(1, Math.min(explicit, jobs, MAX_BATCH_WORKERS));
  }

  const m = ENCODER_CAPS[mode] ? mode : "balanced";
  const caps = ENCODER_CAPS[m];
  const cpus = os.cpus()?.length || 4;
  const profile = normalizeEncodeProfile(encodeProfile);
  const effectiveHwEncoder = getEffectiveHwEncoder(profile, hwEncoder);
  let workers;

  if (effectiveHwEncoder) {
    const cap = caps[effectiveHwEncoder] ?? caps.h264_nvenc ?? 2;
    workers = Math.max(1, Math.min(cap, jobs));
    if (m === "balanced" && effectiveHwEncoder !== "h264_mf" && jobs >= AUTO_TARGET_WORKERS) {
      workers = Math.max(workers, Math.min(AUTO_TARGET_WORKERS, jobs, cap));
    }
  } else if (m === "conservative") {
    workers = Math.max(1, Math.min(Math.max(2, cpus - 1), 6, jobs));
  } else {
    const cpuCap = Math.min(Math.max(2, cpus - 2), 8);
    workers = Math.max(1, Math.min(cpuCap, jobs));
    if (jobs >= AUTO_TARGET_WORKERS) {
      workers = Math.max(workers, Math.min(AUTO_TARGET_WORKERS, jobs, cpuCap));
    }
  }

  if (maxSourcePixels >= 3840 * 2160) {
    workers = Math.min(workers, 2);
  }

  if (hasVideoFilters && !profileAllowsHardware(profile)) {
    workers = Math.min(workers, 2);
  } else if (hasVideoFilters && maxSourcePixels >= 1920 * 1080) {
    workers = Math.min(workers, 3);
  }

  return workers;
}

export function recommendBatchWorkers(opts = {}) {
  const profile = normalizeEncodeProfile(opts.encodeProfile);
  const encoder = getEffectiveHwEncoder(profile, opts.hwEncoder || null);
  const workers = resolveBatchWorkers({ ...opts, hwEncoder: encoder, encodeProfile: profile });
  const mode = opts.mode === "conservative" ? "conservative" : "balanced";
  let reason = "cpu";

  if (encoder === "h264_mf") {
    reason = "mf_single";
  } else if (encoder) {
    reason = mode === "balanced" ? "gpu_balanced" : "gpu_conservative";
  } else if (mode === "balanced") {
    reason = "cpu_balanced";
  }

  return { recommended: workers, encoder, mode, reason };
}

const WIN_ENCODER_PRIORITY = ["h264_nvenc", "h264_qsv", "h264_mf", "h264_amf"];
const DARWIN_ENCODER_PRIORITY = ["h264_videotoolbox", "h264_nvenc", "h264_qsv"];
const LINUX_ENCODER_PRIORITY = ["h264_nvenc", "h264_vaapi", "h264_qsv", "h264_amf"];

export function pickHwEncoderFromEncodersText(text) {
  if (!text || typeof text !== "string") return null;
  const priority =
    process.platform === "win32"
      ? WIN_ENCODER_PRIORITY
      : process.platform === "darwin"
        ? DARWIN_ENCODER_PRIORITY
        : LINUX_ENCODER_PRIORITY;
  for (const enc of priority) {
    if (text.includes(enc)) return enc;
  }
  return null;
}
