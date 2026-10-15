import { COMPOSITION_LIMITS } from "../../../shared/composition-settings.js";
import {
  activeClipsAt,
  insertClip,
  setCanvas,
  splitClip,
  trimClip,
} from "../../../shared/editor-timeline.js";
import { EditorError } from "../../../shared/editor-project.js";

export const US_PER_SECOND = 1_000_000;
export const DEFAULT_CANVAS_LIMIT = 1920;

export const secondsToUs = (seconds) => Math.round(seconds * US_PER_SECOND);
export const usToSeconds = (us) => us / US_PER_SECOND;

export function formatClock(seconds) {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const rest = (safe - minutes * 60).toFixed(2).padStart(5, "0");
  return `${minutes}:${rest}`;
}

export function formatTimecode(seconds, fps) {
  const totalFrames = Math.floor(Math.max(0, seconds) * fps + 1e-6);
  const perSecond = Math.ceil(fps);
  const frames = totalFrames % perSecond;
  const wholeSeconds = Math.floor(totalFrames / perSecond);
  const pad = (n) => String(n).padStart(2, "0");
  return [
    Math.floor(wholeSeconds / 3600),
    Math.floor(wholeSeconds / 60) % 60,
    wholeSeconds % 60,
    frames,
  ]
    .map(pad)
    .join(":");
}

export const evenDimension = (value) =>
  Math.max(COMPOSITION_LIMITS.minCanvasDimension, Math.round(value / 2) * 2);

export function canvasForSource(width, height, limit = DEFAULT_CANVAS_LIMIT) {
  const scale = Math.min(1, limit / Math.max(width, height));
  return { width: evenDimension(width * scale), height: evenDimension(height * scale) };
}

export const ASSET_DRAG_TYPE = "application/x-beru-editor-asset";
export const IMAGE_DRAG_TYPE = "application/x-beru-editor-image";

export const isImageAsset = (asset) => asset.metadata?.durationUs == null;

export function appendClipFromAsset(project, assetId, index = null) {
  const asset = project.assets.find((a) => a.id === assetId);
  if (!asset) throw new EditorError("Asset inexistente");
  const durationUs = asset.metadata?.durationUs;
  if (durationUs == null) throw new EditorError("La fuente no tiene duración conocida");
  let next = project;
  if (project.clips.length === 0 && asset.metadata.width && asset.metadata.height) {
    next = setCanvas(next, canvasForSource(asset.metadata.width, asset.metadata.height));
  }
  return insertClip(next, {
    assetId,
    index,
    sourceInUs: 0,
    sourceOutUs: durationUs,
  }).project;
}

export function setClipRange(project, clipId, inSeconds, outSeconds) {
  return trimClip(project, clipId, {
    sourceInUs: secondsToUs(inSeconds),
    sourceOutUs: secondsToUs(outSeconds),
  });
}

export const CANVAS_PRESETS = {
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
};

export function canvasPresetKey(canvas) {
  return (
    Object.keys(CANVAS_PRESETS).find(
      (key) =>
        CANVAS_PRESETS[key].width === canvas.width && CANVAS_PRESETS[key].height === canvas.height,
    ) ?? "custom"
  );
}

export function applyCanvasPreset(project, key) {
  const preset = CANVAS_PRESETS[key];
  if (!preset) throw new EditorError(`Preset de lienzo desconocido: ${key}`);
  return setCanvas(project, preset);
}

export function splitAtPlayhead(project, playheadUs) {
  const [entry] = activeClipsAt(project, playheadUs);
  if (!entry || playheadUs <= entry.startUs || playheadUs >= entry.endUs) return null;
  return splitClip(project, entry.clip.id, playheadUs);
}
