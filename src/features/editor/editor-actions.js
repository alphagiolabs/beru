import {
  addAsset,
  addImageOverlay,
  addTextOverlay,
  duplicateClip,
  moveClip,
  relinkAsset,
  removeClip,
  removeOverlay,
  setCanvas,
  setClipMuted,
  setClipSpeed,
  setClipTransform,
  updateOverlay,
} from "../../../shared/editor-timeline.js";
import { buildCompositionManifest } from "./composition.js";
import { selectIsDirty, useTimelineStore } from "./store/useTimelineStore.js";
import {
  applyCanvasPreset,
  appendClipFromAsset,
  isImageAsset,
  splitAtPlayhead,
} from "./editor-model.js";

const store = () => useTimelineStore.getState();
const superseded = () => ({ success: false, canceled: true, superseded: true });
let openSequence = 0;

function assetStatusMap(assets = []) {
  return Object.fromEntries(assets.map(({ id, status }) => [id, status]));
}

export async function importSources(api, paths = null) {
  const owner = store().documentOwner;
  const result = await api.importEditorVideos(paths ? { paths } : undefined);
  if (store().documentOwner !== owner) return superseded();
  if (!result?.success) return result;
  if (result.sources.length === 0) return { success: true, imported: 0, errors: result.errors };
  let newIds = [];
  const applied = store().apply((present) => {
    let project = present;
    newIds = result.sources.map((source) => {
      const added = addAsset(project, source);
      project = added.project;
      return added.assetId;
    });
    return project.clips.length === 0 ? appendClipFromAsset(project, newIds[0]) : project;
  });
  if (!applied) return { success: false, error: store().lastError };
  store().setAssetStatus({
    ...store().assetStatus,
    ...Object.fromEntries(newIds.map((id) => [id, "ready"])),
  });
  return { success: true, imported: result.sources.length, errors: result.errors };
}

export async function openDocument(api, { confirmDiscard } = {}) {
  const owner = store().documentOwner;
  const sequence = ++openSequence;
  if (selectIsDirty(store()) && !(await confirmDiscard?.()))
    return { success: false, canceled: true };
  if (sequence !== openSequence || store().documentOwner !== owner) return superseded();
  const result = await api.openEditorProject();
  if (sequence !== openSequence || store().documentOwner !== owner) return superseded();
  if (!result?.success) return result;
  store().open(result.project, {
    filePath: result.filePath,
    assetStatus: assetStatusMap(result.assets),
  });
  return result;
}

export async function saveDocument(api, { saveAs = false } = {}) {
  const { history, revision, savedRevision, filePath, documentOwner } = store();
  const project = history.present;
  const result = await api.saveEditorProject({
    project: { ...project, revision },
    baseRevision: savedRevision ?? undefined,
    filePath,
    saveAs: saveAs || !filePath,
  });
  if (store().documentOwner !== documentOwner) return superseded();
  if (result?.success) store().markSaved({ project, revision, filePath: result.filePath });
  return result;
}

export async function relinkLibraryAsset(api, assetId) {
  const owner = store().documentOwner;
  const asset = store().history.present.assets.find((a) => a.id === assetId);
  const result = await api.pickEditorReplacement({
    kind: asset && isImageAsset(asset) ? "image" : "video",
  });
  if (store().documentOwner !== owner) return superseded();
  if (!result?.success) return result;
  if (!store().apply((project) => relinkAsset(project, assetId, result.source))) {
    return { success: false, error: store().lastError };
  }
  store().setAssetStatus({ ...store().assetStatus, [assetId]: "ready" });
  return { success: true };
}

export async function createPreviewProxy(api, asset) {
  const owner = store().documentOwner;
  const result = await api.createEditorPreviewProxy({
    source: {
      path: asset.path,
      sizeBytes: asset.sizeBytes,
      mtimeMs: asset.mtimeMs,
      durationUs: asset.metadata.durationUs,
    },
  });
  if (store().documentOwner !== owner) return superseded();
  if (result.success) store().setPreviewPath(asset.id, result.path);
  return result;
}

export function appendLibraryAsset(assetId, index = null) {
  return store().apply((p) => appendClipFromAsset(p, assetId, index));
}

function applyOverlayOperation(operation) {
  let overlayId = null;
  const applied = store().apply((project) => {
    const result = operation(project);
    overlayId = result.overlayId ?? null;
    return result.project;
  });
  return applied ? overlayId : null;
}

export function addTitleAt(startUs, text) {
  return applyOverlayOperation((p) => addTextOverlay(p, { startUs, text }));
}

export function addImageLayerAt(assetId, startUs) {
  return applyOverlayOperation((p) => addImageOverlay(p, { assetId, startUs }));
}

export async function importImageLayer(api, startUs) {
  const owner = store().documentOwner;
  const result = await api.importEditorImage();
  if (store().documentOwner !== owner) return superseded();
  if (!result?.success) return result;
  let assetId = null;
  const overlayId = applyOverlayOperation((p) => {
    const added = addAsset(p, result.source);
    assetId = added.assetId;
    return addImageOverlay(added.project, { assetId, startUs });
  });
  if (!overlayId) return { success: false, error: store().lastError };
  store().setAssetStatus({ ...store().assetStatus, [assetId]: "ready" });
  return { success: true, overlayId };
}

export function updateOverlayOf(overlayId, patch) {
  return store().apply((p) => updateOverlay(p, overlayId, patch));
}

export function removeOverlayOf(overlayId) {
  return store().apply((p) => removeOverlay(p, overlayId));
}

export function splitClipAtPlayhead(playheadUs) {
  let split = null;
  store().apply((p) => {
    split = splitAtPlayhead(p, playheadUs);
    return split ? split.project : p;
  });
  return split;
}

export function duplicateTimelineClip(clipId) {
  let copyId = null;
  store().apply((p) => {
    const result = duplicateClip(p, clipId);
    copyId = result.clipId;
    return result.project;
  });
  return copyId;
}

export function removeTimelineClip(clipId) {
  return store().apply((p) => removeClip(p, clipId));
}

export function beginTimelineGesture() {
  store().beginGesture();
}

export function previewMoveClip(clipId, index) {
  store().preview((p) => moveClip(p, clipId, index));
}

export function previewClipOperation(operation) {
  store().preview(operation);
}

export function endTimelineGesture() {
  store().endGesture();
}

export function cancelTimelineGesture() {
  store().cancelGesture();
}

export function setSpeedOfClip(clipId, speed) {
  return store().apply((p) => setClipSpeed(p, clipId, speed));
}

export function setMuteOfClip(clipId, muted) {
  return store().apply((p) => setClipMuted(p, clipId, muted));
}

export function setTransformOfClip(clipId, patch, { live = false } = {}) {
  const state = store();
  const operation = (p) => setClipTransform(p, clipId, patch);
  return live && state.history.gesture ? state.preview(operation) : state.apply(operation);
}

export function setCanvasPreset(key) {
  return store().apply((p) => applyCanvasPreset(p, key));
}

export function setCanvasSize(width, height) {
  return store().apply((p) => setCanvas(p, { width, height }));
}

export function setCanvasBackground(background) {
  return store().apply((p) => setCanvas(p, { background }));
}

export function exportComposition(api, options) {
  const manifest = buildCompositionManifest(store().history.present, options);
  return api.exportEditorComposition({ manifest });
}
