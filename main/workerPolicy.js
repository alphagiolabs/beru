import policy from "../resources/worker-policy.json" with { type: "json" };
import os from "os";
import {
  ENCODE_PROFILES,
  normalizeEncodeProfile,
  profileAllowsHardware,
  getEffectiveHwEncoder,
} from "./encodeProfiles.js";

const MAX_BATCH_WORKERS = policy.maxWorkers;
const RAM_PER_JOB_MB = policy.ramPerJobMb;
const X264_PRESET_RAM_MULT = policy.x264PresetRamMultipliers;
const HEAVY_DECODE_CODECS = new Set(policy.heavyDecodeCodecs);
const HIGH_BIT_DEPTH_TOKENS = policy.highBitDepthTokens;
const ENCODER_CAPS = policy.encoderCaps;

function getAvailableRamMb() {
  try {
    return Math.max(0, Math.floor(os.freemem() / (1024 * 1024)));
  } catch {
    return 0;
  }
}

export function estimateJobRamMb({
  hwEncoder = null,
  hasVideoFilters = false,
  encodeProfile = "balanced",
  sourcePixels = 0,
  speedPreset = null,
  videoCodec = "",
  pixFmt = "",
  sourceWidth = 0,
  sourceHeight = 0,
} = {}) {
  const profile = normalizeEncodeProfile(encodeProfile);
  const hardwareAllowed = profileAllowsHardware(profile);
  let key;
  if (hasVideoFilters && !hardwareAllowed) key = "software";
  else if (hwEncoder === "h264_nvenc") key = "nvenc";
  else if (hwEncoder === "h264_qsv") key = "qsv";
  else if (hwEncoder === "h264_amf") key = "amf";
  else if (hwEncoder === "h264_mf") key = "mf";
  else key = "software";

  let perJob = RAM_PER_JOB_MB[key];
  if (key === "software") {
    const preset = String(speedPreset || ENCODE_PROFILES[profile]?.preset || "fast")
      .trim()
      .toLowerCase();
    perJob = Math.floor(perJob * (X264_PRESET_RAM_MULT[preset] ?? 1.0));
  }
  const codec = String(videoCodec || "").toLowerCase();
  if (HEAVY_DECODE_CODECS.has(codec))
    perJob = Math.floor(perJob * policy.ramMultipliers.heavyDecode);
  const pix = String(pixFmt || "").toLowerCase();
  if (HIGH_BIT_DEPTH_TOKENS.some((t) => pix.includes(t)))
    perJob = Math.floor(perJob * policy.ramMultipliers.highBitDepth);
  if (hasVideoFilters) perJob = Math.floor(perJob * policy.ramMultipliers.filters);
  if (!hardwareAllowed || (profile === "quality" && !hwEncoder))
    perJob = Math.floor(perJob * policy.ramMultipliers.softwareQuality);

  let pixels = Number(sourcePixels) || 0;
  const w = Number(sourceWidth) || 0;
  const h = Number(sourceHeight) || 0;
  if (w > 0 && h > 0) pixels = w * h;
  if (pixels >= 3840 * 2160) perJob = Math.floor(perJob * policy.ramMultipliers.ultraHd);
  else if (pixels >= 1920 * 1080) perJob = Math.floor(perJob * policy.ramMultipliers.fullHd);
  return Math.max(policy.minimumJobRamMb, perJob);
}

function memoryCapWorkers({
  hwEncoder = null,
  maxSourcePixels = 0,
  desiredWorkers,
  hasVideoFilters = false,
  encodeProfile = "balanced",
  jobs = [],
  availableRamMb = null,
} = {}) {
  const avail = availableRamMb != null ? availableRamMb : getAvailableRamMb();
  if (avail <= 0) return desiredWorkers;
  let perJob = 0;
  const entries = Array.isArray(jobs) ? jobs.filter((j) => j && typeof j === "object") : [];
  if (entries.length > 0) {
    perJob = Math.max(
      ...entries.map((j) => estimateJobRamMb({ hwEncoder, hasVideoFilters, encodeProfile, ...j })),
    );
  }
  if (perJob <= 0) {
    perJob = estimateJobRamMb({
      hwEncoder,
      hasVideoFilters,
      encodeProfile,
      sourcePixels: maxSourcePixels,
    });
  }
  const cap = Math.max(1, Math.floor((avail * policy.memoryBudgetFraction) / perJob));
  return Math.max(1, Math.min(cap, desiredWorkers, MAX_BATCH_WORKERS));
}

export function resolveBatchWorkers({
  hwEncoder = null,
  jobCount = 1,
  maxSourcePixels = 0,
  mode = "balanced",
  explicitWorkers = 0,
  hasVideoFilters = false,
  encodeProfile = "balanced",
  jobEntries = [],
  availableRamMb = null,
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
    const cap = caps[effectiveHwEncoder] ?? caps.h264_nvenc;
    workers = Math.max(1, Math.min(cap, jobs));
  } else if (m === "conservative") {
    workers = Math.max(1, Math.min(Math.max(2, cpus - 1), 6, jobs));
  } else {
    const cpuCap = Math.min(Math.max(2, cpus - 2), 8);
    workers = Math.max(1, Math.min(cpuCap, jobs));
  }

  if (maxSourcePixels >= 3840 * 2160) {
    workers = Math.min(workers, 2);
  }

  const qualitySoftwareFilters = profile === "quality" && !effectiveHwEncoder;
  if (hasVideoFilters && (!profileAllowsHardware(profile) || qualitySoftwareFilters)) {
    workers = Math.min(workers, 2);
  } else if (hasVideoFilters && maxSourcePixels >= 1920 * 1080) {
    workers = Math.min(workers, Math.max(3, Math.min(6, cpus - 4)));
  }

  workers = memoryCapWorkers({
    hwEncoder: effectiveHwEncoder,
    maxSourcePixels,
    desiredWorkers: workers,
    hasVideoFilters,
    encodeProfile: profile,
    jobs: jobEntries,
    availableRamMb,
  });

  return workers;
}

export function recommendBatchWorkers(opts = {}) {
  const profile = normalizeEncodeProfile(opts.encodeProfile);
  const encoder = getEffectiveHwEncoder(profile, opts.hwEncoder || null);
  const workers = resolveBatchWorkers({
    ...opts,
    hwEncoder: encoder,
    encodeProfile: profile,
  });
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

export function pickHwEncoderFromEncodersText(text) {
  if (!text || typeof text !== "string") return null;
  for (const enc of WIN_ENCODER_PRIORITY) {
    if (text.includes(enc)) return enc;
  }
  return null;
}
