import { clipTimeline } from "./clip-timeline.js";
import { EditorError, assertEditorProject, assetKey, newEditorId } from "./editor-project.js";
import { normalizeClipTransform } from "./clip-transform.js";
import { DEFAULT_OVERLAY_STYLE, OVERLAY_MAX_COUNT } from "./overlay-style.js";

const insertAt = (list, index, value) => [...list.slice(0, index), value, ...list.slice(index)];

function findTrack(project, trackId) {
  const track = trackId ? project.tracks.find((t) => t.id === trackId) : project.tracks[0];
  if (!track) throw new EditorError("Pista inexistente");
  return track;
}

function findClip(project, clipId) {
  const clip = project.clips.find((c) => c.id === clipId);
  if (!clip) throw new EditorError("Clip inexistente");
  return clip;
}

function findAsset(project, assetId) {
  const asset = project.assets.find((a) => a.id === assetId);
  if (!asset) throw new EditorError("Asset inexistente");
  return asset;
}

function replaceTrackClipIds(project, trackId, clipIds) {
  return project.tracks.map((t) => (t.id === trackId ? { ...t, clipIds } : t));
}

function clipDurationSeconds(clip) {
  return clipTimeline({
    duration: clip.sourceOutUs / 1e6,
    trimStart: clip.sourceInUs / 1e6,
    trimEnd: clip.sourceOutUs / 1e6,
    timing: { rate: clip.speed, repeatCount: 1 },
  }).totalDuration;
}

export function clipDurationUs(clip) {
  return Math.round(clipDurationSeconds(clip) * 1e6);
}

export function layoutTrack(project, trackId) {
  const track = findTrack(project, trackId);
  const clipsById = new Map(project.clips.map((c) => [c.id, c]));
  const fps = project.fps.num / project.fps.den;
  let cursorFrames = 0;
  return track.clipIds.map((id) => {
    const clip = clipsById.get(id);
    const startUs = Math.round((cursorFrames / fps) * 1e6);
    cursorFrames += Math.ceil(clipDurationSeconds(clip) * fps - 1e-8);
    return { clip, startUs, endUs: Math.round((cursorFrames / fps) * 1e6) };
  });
}

export function projectDurationUs(project) {
  let end = 0;
  for (const track of project.tracks) {
    for (const entry of layoutTrack(project, track.id)) end = Math.max(end, entry.endUs);
  }
  for (const overlay of project.overlays) end = Math.max(end, overlay.endUs);
  return end;
}

export function activeClipsAt(project, timeUs) {
  return project.tracks.flatMap((track) =>
    layoutTrack(project, track.id).filter(
      (entry) => entry.startUs <= timeUs && timeUs < entry.endUs,
    ),
  );
}

export function sourceTimeAt(entry, timeUs) {
  return entry.clip.sourceInUs + Math.round((timeUs - entry.startUs) * entry.clip.speed);
}

export function addAsset(project, source) {
  const key = assetKey(source.path);
  const existing = project.assets.find((a) => assetKey(a.path) === key);
  if (existing) return { project, assetId: existing.id };
  const asset = {
    id: newEditorId("asset"),
    path: source.path,
    filename: source.filename,
    sizeBytes: source.sizeBytes ?? null,
    mtimeMs: source.mtimeMs ?? null,
    metadata: { ...source.metadata, durationUs: source.metadata?.durationUs ?? null },
  };
  const next = assertEditorProject({ ...project, assets: [...project.assets, asset] });
  return { project: next, assetId: asset.id };
}

export function relinkAsset(project, assetId, source) {
  const asset = findAsset(project, assetId);
  const key = assetKey(source.path);
  if (project.assets.some((a) => a.id !== asset.id && assetKey(a.path) === key)) {
    throw new EditorError("Ya existe un asset con esa ruta");
  }
  const relinked = {
    ...asset,
    path: source.path,
    filename: source.filename,
    sizeBytes: source.sizeBytes ?? null,
    mtimeMs: source.mtimeMs ?? null,
    metadata: { ...asset.metadata, ...source.metadata },
  };
  return assertEditorProject({
    ...project,
    assets: project.assets.map((a) => (a.id === assetId ? relinked : a)),
  });
}

export function insertClip(
  project,
  { assetId, trackId, index, sourceInUs = 0, sourceOutUs, speed = 1 },
) {
  const track = findTrack(project, trackId);
  const asset = findAsset(project, assetId);
  const outUs = sourceOutUs ?? asset.metadata.durationUs;
  if (outUs == null) throw new EditorError("La fuente no tiene duración conocida");
  const position = index ?? track.clipIds.length;
  if (!Number.isInteger(position) || position < 0 || position > track.clipIds.length) {
    throw new EditorError("Posición inválida");
  }
  const clip = {
    id: newEditorId("clip"),
    assetId,
    trackId: track.id,
    sourceInUs,
    sourceOutUs: outUs,
    speed,
    muted: false,
    transform: normalizeClipTransform(),
  };
  const next = {
    ...project,
    clips: [...project.clips, clip],
    tracks: replaceTrackClipIds(project, track.id, insertAt(track.clipIds, position, clip.id)),
  };
  return { project: assertEditorProject(next), clipId: clip.id };
}

export function trimClip(project, clipId, { sourceInUs, sourceOutUs }) {
  const clip = findClip(project, clipId);
  const trimmed = {
    ...clip,
    sourceInUs: sourceInUs ?? clip.sourceInUs,
    sourceOutUs: sourceOutUs ?? clip.sourceOutUs,
  };
  return assertEditorProject({
    ...project,
    clips: project.clips.map((c) => (c.id === clipId ? trimmed : c)),
  });
}

export function splitClip(project, clipId, timelineUs) {
  const clip = findClip(project, clipId);
  const entry = layoutTrack(project, clip.trackId).find((e) => e.clip.id === clipId);
  if (!(entry.startUs < timelineUs && timelineUs < entry.endUs)) {
    throw new EditorError("El corte debe caer dentro del clip");
  }
  const splitUs = sourceTimeAt(entry, timelineUs);
  if (!(clip.sourceInUs < splitUs && splitUs < clip.sourceOutUs)) {
    throw new EditorError("El corte queda fuera del intervalo de fuente");
  }
  const left = { ...clip, id: newEditorId("clip"), sourceOutUs: splitUs };
  const right = { ...clip, id: newEditorId("clip"), sourceInUs: splitUs };
  const track = findTrack(project, clip.trackId);
  const clipIds = track.clipIds.flatMap((id) => (id === clipId ? [left.id, right.id] : [id]));
  const next = {
    ...project,
    clips: [...project.clips.filter((c) => c.id !== clipId), left, right],
    tracks: replaceTrackClipIds(project, track.id, clipIds),
  };
  return { project: assertEditorProject(next), leftId: left.id, rightId: right.id };
}

export function duplicateClip(project, clipId) {
  const clip = findClip(project, clipId);
  const track = findTrack(project, clip.trackId);
  const copy = { ...clip, id: newEditorId("clip") };
  const position = track.clipIds.indexOf(clipId) + 1;
  const next = {
    ...project,
    clips: [...project.clips, copy],
    tracks: replaceTrackClipIds(project, track.id, insertAt(track.clipIds, position, copy.id)),
  };
  return { project: assertEditorProject(next), clipId: copy.id };
}

export function removeClip(project, clipId) {
  const clip = findClip(project, clipId);
  const track = findTrack(project, clip.trackId);
  const next = {
    ...project,
    clips: project.clips.filter((c) => c.id !== clipId),
    tracks: replaceTrackClipIds(
      project,
      track.id,
      track.clipIds.filter((id) => id !== clipId),
    ),
  };
  return assertEditorProject(next);
}

export function moveClip(project, clipId, toIndex) {
  const clip = findClip(project, clipId);
  const track = findTrack(project, clip.trackId);
  const rest = track.clipIds.filter((id) => id !== clipId);
  if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex > rest.length) {
    throw new EditorError("Posición inválida");
  }
  return assertEditorProject({
    ...project,
    tracks: replaceTrackClipIds(project, track.id, insertAt(rest, toIndex, clipId)),
  });
}

export function setClipSpeed(project, clipId, speed) {
  const clip = findClip(project, clipId);
  return assertEditorProject({
    ...project,
    clips: project.clips.map((c) => (c.id === clip.id ? { ...c, speed } : c)),
  });
}

export function setClipMuted(project, clipId, muted) {
  const clip = findClip(project, clipId);
  return assertEditorProject({
    ...project,
    clips: project.clips.map((c) => (c.id === clip.id ? { ...c, muted } : c)),
  });
}

export function setClipTransform(project, clipId, patch) {
  const clip = findClip(project, clipId);
  const transform = normalizeClipTransform({ ...clip.transform, ...patch });
  return assertEditorProject({
    ...project,
    clips: project.clips.map((c) => (c.id === clip.id ? { ...c, transform } : c)),
  });
}

export function setCanvas(project, patch) {
  const { width, height, background } = { ...project.canvas, ...patch };
  return assertEditorProject({ ...project, canvas: { width, height, background } });
}

export const DEFAULT_OVERLAY_US = 3_000_000;
const DEFAULT_TEXT_GEOMETRY = { x: 0.1, y: 0.4, w: 0.8, h: 0.2 };
const DEFAULT_IMAGE_GEOMETRY = { x: 0.7, y: 0.05, w: 0.25, h: 0.25 };

function findOverlay(project, overlayId) {
  const overlay = project.overlays.find((o) => o.id === overlayId);
  if (!overlay) throw new EditorError("Superposición inexistente");
  return overlay;
}

function appendOverlay(project, overlay) {
  if (project.overlays.length >= OVERLAY_MAX_COUNT) {
    throw new EditorError(`No se pueden añadir más de ${OVERLAY_MAX_COUNT} superposiciones`);
  }
  return assertEditorProject({ ...project, overlays: [...project.overlays, overlay] });
}

export function addTextOverlay(project, { startUs, endUs = startUs + DEFAULT_OVERLAY_US, text }) {
  const overlay = {
    id: newEditorId("overlay"),
    kind: "text",
    startUs,
    endUs,
    geometry: { ...DEFAULT_TEXT_GEOMETRY },
    text,
    style: { ...DEFAULT_OVERLAY_STYLE },
  };
  return { project: appendOverlay(project, overlay), overlayId: overlay.id };
}

export function addImageOverlay(
  project,
  { assetId, startUs, endUs = startUs + DEFAULT_OVERLAY_US },
) {
  const asset = findAsset(project, assetId);
  if (asset.metadata?.durationUs != null) {
    throw new EditorError("La superposición de imagen requiere una imagen");
  }
  const overlay = {
    id: newEditorId("overlay"),
    kind: "image",
    startUs,
    endUs,
    geometry: { ...DEFAULT_IMAGE_GEOMETRY },
    assetId,
  };
  return { project: appendOverlay(project, overlay), overlayId: overlay.id };
}

export function updateOverlay(project, overlayId, patch) {
  const overlay = findOverlay(project, overlayId);
  const { startUs, endUs, text, style, geometry } = patch;
  const next = {
    ...overlay,
    ...(startUs !== undefined ? { startUs } : {}),
    ...(endUs !== undefined ? { endUs } : {}),
    ...(text !== undefined ? { text } : {}),
    ...(style ? { style: { ...overlay.style, ...style } } : {}),
    ...(geometry ? { geometry: { ...overlay.geometry, ...geometry } } : {}),
  };
  return assertEditorProject({
    ...project,
    overlays: project.overlays.map((o) => (o.id === overlayId ? next : o)),
  });
}

export function removeOverlay(project, overlayId) {
  findOverlay(project, overlayId);
  return assertEditorProject({
    ...project,
    overlays: project.overlays.filter((o) => o.id !== overlayId),
  });
}

export function overlaysAt(project, timeUs) {
  return project.overlays.filter((o) => o.startUs <= timeUs && timeUs < o.endUs);
}
