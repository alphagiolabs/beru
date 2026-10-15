import { audioAssetJob } from "./audio-asset.js";
import { normalizeTiming } from "./clip-timeline.js";
import { transformJobFields } from "./video-transform.js";

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

const VIDEO_EDIT_FIELDS = [
  "operations",
  "watermark",
  "rotation",
  "flip_h",
  "flip_v",
  "output_height",
  "output_width",
  "fit_mode",
  "audio_gain",
  "audio_muted",
  "external_audio",
  "playback_rate",
  "repeat_count",
  "trim_start",
  "trim_end",
];
const VIDEO_SOURCE_FIELDS = [
  "input_path",
  "input_root",
  "asset_roots",
  "width",
  "height",
  "source_width",
  "source_height",
  "video_duration",
  "frame_rate",
  "video_codec",
  "pix_fmt",
  "audio_codec",
  "audio_channels",
  "video_info_probed",
];
const withoutFields = (job, fields) =>
  Object.fromEntries(Object.entries(job).filter(([key]) => !fields.includes(key)));

export function normalizeJob(job, index = 0) {
  if (!isPlainObject(job)) return job;
  const kind = job.kind ?? "video";
  if (!["video", "composition", "stabilization"].includes(kind))
    throw new Error("Tipo de job inválido");
  const common = {
    ...job,
    kind,
    id: Number.isInteger(job.id) ? job.id : index,
    encode_profile: toNonEmptyString(job.encode_profile, DEFAULT_ENCODE_PROFILE),
  };
  if (kind === "composition") {
    const clips = Array.isArray(job.clips)
      ? job.clips.map((clip, i) => {
          if (!isPlainObject(clip) || (clip.kind != null && clip.kind !== "video"))
            throw new Error("Entrada de composición inválida");
          return normalizeJob(clip, i);
        })
      : job.clips;
    return {
      ...withoutFields(common, [...VIDEO_SOURCE_FIELDS, ...VIDEO_EDIT_FIELDS]),
      clips,
      canvas: isPlainObject(job.canvas) ? { ...job.canvas } : job.canvas,
      composition_fps: toFiniteNumber(job.composition_fps, job.composition_fps),
    };
  }
  if (kind === "stabilization") {
    return {
      ...withoutFields(common, VIDEO_EDIT_FIELDS),
      stabilization: isPlainObject(job.stabilization)
        ? { ...job.stabilization }
        : job.stabilization,
      sample_seconds: job.sample_seconds ?? null,
    };
  }
  const sourceWidth =
    Math.trunc(toFiniteNumber(job.source_width, 0)) || Math.trunc(toFiniteNumber(job.width, 0));
  const sourceHeight =
    Math.trunc(toFiniteNumber(job.source_height, 0)) || Math.trunc(toFiniteNumber(job.height, 0));
  const duration = toFiniteNumber(job.video_duration, 0);
  const pixFmt = toNonEmptyString(job.pix_fmt, "");
  const rawTrimStart = job.trim_start;
  const rawTrimEnd = job.trim_end;
  const rawAudioGain = job.audio_gain;
  const external = job.external_audio;
  const externalAudio =
    external == null
      ? null
      : audioAssetJob({ ...external, trimStart: external.trim_start, trimEnd: external.trim_end });
  if (external != null && !externalAudio) throw new Error("Audio externo inválido");
  const audioGain =
    rawAudioGain == null || (typeof rawAudioGain === "string" && !rawAudioGain.trim())
      ? 1
      : toFiniteNumber(rawAudioGain, 1);
  const timing = normalizeTiming({ rate: job.playback_rate, repeatCount: job.repeat_count });
  return {
    ...common,
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
    ...transformJobFields({
      rotation: job.rotation,
      flipH: job.flip_h,
      flipV: job.flip_v,
      outputHeight: job.output_height,
      outputWidth: job.output_width,
      fitMode: job.fit_mode,
    }),
    audio_gain: Math.min(1, Math.max(0, audioGain)),
    audio_muted: job.audio_muted === true,
    external_audio: externalAudio,
    playback_rate: timing.rate,
    repeat_count: timing.repeatCount,
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

export function jobInputClips(job) {
  return job?.kind === "composition" ? job.clips || [] : [job];
}

export function jobMediaSources(job) {
  const sources =
    job?.kind === "composition"
      ? (job.overlays ?? [])
          .filter((o) => o.kind === "image")
          .map((o) => ({ path: o.source?.path, kind: "image" }))
      : [];
  for (const clip of jobInputClips(job)) {
    sources.push({ path: clip?.input_path, kind: "video" });
    if (clip?.kind === "stabilization") continue;
    if (clip?.external_audio) sources.push({ path: clip.external_audio.path, kind: "audio" });
    for (const op of clip?.operations || []) {
      for (const imagePath of [op.image_path, op.delogo_image_path])
        if (imagePath) sources.push({ path: imagePath, kind: "image" });
    }
    if (clip?.watermark?.type === "image") {
      const imagePath = clip.watermark.imagePath || clip.watermark.watermark_image;
      if (imagePath) sources.push({ path: imagePath, kind: "image" });
    }
  }
  return sources;
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
