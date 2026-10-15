import { sourceTimeAt } from "../../../../shared/editor-timeline.js";

export const PRELOAD_LEAD_US = 1_500_000;

export function entryAt(layout, timeUs) {
  return layout.find((entry) => entry.startUs <= timeUs && timeUs < entry.endUs) ?? null;
}

export function nextEntryAfter(layout, clipId) {
  const index = layout.findIndex((entry) => entry.clip.id === clipId);
  return index >= 0 ? (layout[index + 1] ?? null) : null;
}

export function sourceSecondsAt(entry, timeUs) {
  return sourceTimeAt(entry, timeUs) / 1_000_000;
}

export function projectUsAtSource(entry, sourceUs) {
  return entry.startUs + Math.round((sourceUs - entry.clip.sourceInUs) / entry.clip.speed);
}

export function decideAdvance(layout, activeClipId, projectUs) {
  const active = layout.find((entry) => entry.clip.id === activeClipId);
  if (!active) return { kind: "end" };
  if (projectUs < active.endUs) return { kind: "continue" };
  const next = nextEntryAfter(layout, activeClipId);
  return next ? { kind: "advance", entry: next } : { kind: "end" };
}

export function preloadTarget(layout, activeClipId, projectUs, preparedClipId) {
  const active = layout.find((entry) => entry.clip.id === activeClipId);
  if (!active || active.endUs - projectUs > PRELOAD_LEAD_US) return null;
  const next = nextEntryAfter(layout, activeClipId);
  if (!next || next.clip.id === preparedClipId) return null;
  return next;
}
