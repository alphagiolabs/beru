export const JOB_MANIFEST_TYPE = "beru-job-manifest";
export const JOB_MANIFEST_VERSION = 1;
export const DEFAULT_PIX_FMT = "yuv420p";
export const DEFAULT_ENCODE_PROFILE = "balanced";

const toFiniteNumber = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const toNonEmptyString = (value, fallback) =>
  typeof value === "string" && value.trim().length > 0 ? value : fallback;

const isPlainObject = (value) =>
  value != null && typeof value === "object" && !Array.isArray(value);

export function normalizeJob(job, index = 0) {
  if (!isPlainObject(job)) return job;
  const sourceWidth =
    Math.trunc(toFiniteNumber(job.source_width, 0)) || Math.trunc(toFiniteNumber(job.width, 0));
  const sourceHeight =
    Math.trunc(toFiniteNumber(job.source_height, 0)) || Math.trunc(toFiniteNumber(job.height, 0));
  const duration = toFiniteNumber(job.video_duration, 0);
  const pixFmt = toNonEmptyString(job.pix_fmt, "");
  const rawTrimStart = job.trim_start;
  const rawTrimEnd = job.trim_end;
  return {
    ...job,
    id: Number.isInteger(job.id) ? job.id : index,
    width: sourceWidth,
    height: sourceHeight,
    source_width: sourceWidth,
    source_height: sourceHeight,
    video_duration: duration,
    frame_rate: toFiniteNumber(job.frame_rate, 0),
    video_codec: typeof job.video_codec === "string" ? job.video_codec : "",
    pix_fmt: pixFmt || DEFAULT_PIX_FMT,
    audio_codec: typeof job.audio_codec === "string" ? job.audio_codec : "",
    audio_channels: Math.trunc(toFiniteNumber(job.audio_channels, 0)),
    encode_profile: toNonEmptyString(job.encode_profile, DEFAULT_ENCODE_PROFILE),
    operations: Array.isArray(job.operations) ? job.operations : [],
    watermark: isPlainObject(job.watermark) ? job.watermark : null,
    trim_start: rawTrimStart == null ? 0 : toFiniteNumber(rawTrimStart, rawTrimStart),
    trim_end: rawTrimEnd == null ? null : toFiniteNumber(rawTrimEnd, rawTrimEnd),
    video_info_probed:
      typeof job.video_info_probed === "boolean"
        ? job.video_info_probed
        : sourceWidth > 0 && sourceHeight > 0 && duration > 0 && pixFmt.length > 0,
  };
}

export function normalizeManifest(payload) {
  if (Array.isArray(payload)) {
    return { manifest: null, jobs: payload.map((job, i) => normalizeJob(job, i)) };
  }
  if (!isPlainObject(payload)) {
    throw new Error("Payload de procesamiento inválido");
  }
  if (payload.type !== JOB_MANIFEST_TYPE) {
    throw new Error("Tipo de manifiesto de procesamiento inválido");
  }
  if (payload.version !== JOB_MANIFEST_VERSION) {
    throw new Error(`Versión de manifiesto no soportada: ${payload.version}`);
  }
  if (!Array.isArray(payload.jobs)) {
    throw new Error("El manifiesto no contiene jobs válidos");
  }
  const jobs = payload.jobs.map((job, i) => normalizeJob(job, i));
  return { manifest: { ...payload, jobs }, jobs };
}
