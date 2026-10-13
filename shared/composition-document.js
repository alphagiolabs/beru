import { normalizeVideoSettings } from "./video-settings.js";
import { clipTimeline } from "./clip-timeline.js";

export const COMPOSITION_TYPE = "beru-composition";
export const COMPOSITION_VERSION = 1;
export const COMPOSITION_JOB_ID = -1;
const ITEM_FIELDS = [
  "path",
  "filename",
  "width",
  "height",
  "sourceWidth",
  "sourceHeight",
  "duration",
  "trimStart",
  "trimEnd",
  "videoCodec",
  "pixFmt",
  "frameRate",
  "audioCodec",
  "audioChannels",
  "operations",
];
const canvasSize = (value) =>
  Number.isInteger(value) && value >= 16 && value <= 4096 && value % 2 === 0;

export function compositionItem(value) {
  if (
    !value ||
    typeof value.path !== "string" ||
    !value.path.trim() ||
    ![value.width, value.height, value.duration].every((n) => Number.isFinite(n) && n > 0)
  )
    return null;
  try {
    const item = JSON.parse(
      JSON.stringify(Object.fromEntries(ITEM_FIELDS.map((key) => [key, value[key]]))),
    );
    item.operations ??= [];
    if (
      !Array.isArray(item.operations) ||
      item.operations.some((op) => !op || typeof op !== "object" || Array.isArray(op))
    )
      return null;
    item.trimStart = value.trimStart == null ? null : Number(value.trimStart);
    item.trimEnd = value.trimEnd == null ? null : Number(value.trimEnd);
    const start = item.trimStart ?? 0,
      end = item.trimEnd ?? item.duration;
    if (![start, end].every(Number.isFinite) || start < 0 || end > item.duration || end <= start)
      return null;
    Object.assign(item, normalizeVideoSettings(value));
    const timeline = clipTimeline(item);
    return timeline.cycleDuration > 0 ? item : null;
  } catch {
    return null;
  }
}

export function parseCompositionDocument(value) {
  if (
    !value ||
    value.type !== COMPOSITION_TYPE ||
    value.version !== COMPOSITION_VERSION ||
    !canvasSize(value.canvas?.width) ||
    !canvasSize(value.canvas?.height) ||
    !["contain", "cover"].includes(value.canvas?.fit) ||
    !Number.isFinite(value.fps) ||
    value.fps < 1 ||
    value.fps > 120 ||
    !Array.isArray(value.entries) ||
    value.entries.length > 50
  )
    return null;
  const entries = value.entries.map((entry) => ({
    id: entry?.id,
    item: compositionItem(entry?.item),
  }));
  if (
    entries.some((entry) => typeof entry.id !== "string" || !entry.id || !entry.item) ||
    new Set(entries.map((entry) => entry.id)).size !== entries.length
  )
    return null;
  const duration = compositionDuration({ entries, fps: value.fps });
  if (duration > 7200) return null;
  return {
    type: COMPOSITION_TYPE,
    version: COMPOSITION_VERSION,
    canvas: { width: value.canvas.width, height: value.canvas.height, fit: value.canvas.fit },
    fps: value.fps,
    outputName:
      typeof value.outputName === "string" ? value.outputName.slice(0, 150) : "composition",
    entries,
  };
}

export function compositionDuration(document) {
  return (
    document?.entries.reduce(
      (sum, entry) =>
        sum +
        Math.ceil(clipTimeline(entry.item).totalDuration * document.fps - 1e-8) / document.fps,
      0,
    ) || 0
  );
}

export function compositionMediaPaths(document) {
  const items = document.entries.map((entry) => entry.item);
  return {
    videoPaths: items.map((item) => item.path),
    audioPaths: items.map((item) => item.externalAudio?.path).filter(Boolean),
    imagePaths: items.flatMap((item) =>
      item.operations.flatMap((op) => [op.imagePath, op.delogoImagePath].filter(Boolean)),
    ),
  };
}
