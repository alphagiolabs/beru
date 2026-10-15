import { COMPOSITION_LIMITS, validateCompositionCanvas } from "./composition-settings.js";
import { validateClipSpeed, validateClipTransform } from "./clip-transform.js";
import {
  validateOverlayGeometry,
  validateOverlayStyle,
  validateOverlayText,
} from "./overlay-style.js";

export const EDIT_PROJECT_TYPE = "beru-edit-project";
export const EDIT_PROJECT_VERSION = 1;
export const EDIT_AUTOSAVE_TYPE = "beru-edit-autosave";

const TRACK_KINDS = new Set(["video"]);
const OVERLAY_KINDS = new Set(["text", "image"]);

export class EditorError extends Error {
  constructor(message) {
    super(message);
    this.name = "EditorError";
  }
}

// getRandomValues works outside secure contexts, unlike randomUUID.
export function newEditorId(prefix) {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(12));
  return `${prefix}_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export function assetKey(filePath) {
  return filePath.replace(/\\/g, "/").toLowerCase();
}

export function createEmptyEditorProject({ name = "Sin título" } = {}) {
  return {
    type: EDIT_PROJECT_TYPE,
    version: EDIT_PROJECT_VERSION,
    name,
    revision: 0,
    fps: { num: 30, den: 1 },
    canvas: { width: 1920, height: 1080, background: "#000000" },
    assets: [],
    tracks: [{ id: newEditorId("track"), kind: "video", clipIds: [] }],
    clips: [],
    overlays: [],
  };
}

const isNonNegInt = (v) => Number.isInteger(v) && v >= 0;
const isPositiveInt = (v) => Number.isInteger(v) && v > 0;
const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;

function fail(message) {
  return { valid: false, error: message };
}

function checkAssetIdentity(asset) {
  if (!asset || typeof asset !== "object") return "Asset inválido";
  if (!isNonEmptyString(asset.id)) return "Asset sin id";
  if (!isNonEmptyString(asset.path)) return `Asset ${asset.id} sin ruta`;
  if (!isNonEmptyString(asset.filename)) return `Asset ${asset.id} sin nombre de archivo`;
  if (asset.sizeBytes !== null && !isNonNegInt(asset.sizeBytes))
    return `Asset ${asset.id}: sizeBytes inválido`;
  if (asset.mtimeMs !== null && typeof asset.mtimeMs !== "number")
    return `Asset ${asset.id}: mtimeMs inválido`;
  const durationUs = asset.metadata?.durationUs;
  if (durationUs !== null && durationUs !== undefined && !isNonNegInt(durationUs)) {
    return `Asset ${asset.id}: duración inválida`;
  }
  return null;
}

function checkUniqueIds(doc) {
  const seen = new Set();
  const groups = [doc.assets, doc.tracks, doc.clips, doc.overlays];
  for (const group of groups) {
    for (const entity of group) {
      if (!isNonEmptyString(entity?.id)) return "Entidad sin id";
      if (seen.has(entity.id)) return `ID duplicado: ${entity.id}`;
      seen.add(entity.id);
    }
  }
  return null;
}

function checkClips(doc, assetsById, tracksById) {
  for (const clip of doc.clips) {
    const asset = assetsById.get(clip.assetId);
    if (!asset) return `Clip ${clip.id} referencia un asset inexistente`;
    if (!tracksById.has(clip.trackId)) return `Clip ${clip.id} referencia una pista inexistente`;
    if (!isNonNegInt(clip.sourceInUs)) return `Clip ${clip.id}: sourceInUs inválido`;
    if (!isNonNegInt(clip.sourceOutUs) || clip.sourceOutUs <= clip.sourceInUs) {
      return `Clip ${clip.id}: intervalo de fuente inválido`;
    }
    const durationUs = asset.metadata?.durationUs;
    if (durationUs != null && clip.sourceOutUs > durationUs) {
      return `Clip ${clip.id} supera la duración de su fuente`;
    }
    const speedError = validateClipSpeed(clip.speed);
    if (speedError) return `Clip ${clip.id}: ${speedError}`;
    if (clip.muted !== undefined && typeof clip.muted !== "boolean") {
      return `Clip ${clip.id}: muted debe ser booleano`;
    }
    if (clip.transform !== undefined) {
      const transformError = validateClipTransform(clip.transform);
      if (transformError) return `Clip ${clip.id}: ${transformError}`;
    }
  }
  return null;
}

function checkTrackMembership(doc, clipsById) {
  const owner = new Set();
  for (const track of doc.tracks) {
    if (!TRACK_KINDS.has(track.kind)) return `Pista ${track.id}: tipo inválido`;
    if (!Array.isArray(track.clipIds)) return `Pista ${track.id}: clipIds debe ser un array`;
    for (const clipId of track.clipIds) {
      const clip = clipsById.get(clipId);
      if (!clip) return `Pista ${track.id} referencia un clip inexistente`;
      if (clip.trackId !== track.id) return `Clip ${clipId} pertenece a otra pista`;
      if (owner.has(clipId)) return `Clip ${clipId} aparece en más de una posición`;
      owner.add(clipId);
    }
  }
  for (const clip of doc.clips) {
    if (!owner.has(clip.id)) return `Clip ${clip.id} no está en ninguna pista`;
  }
  return null;
}

function checkOverlays(doc, assetsById) {
  for (const overlay of doc.overlays) {
    if (!OVERLAY_KINDS.has(overlay.kind)) return `Overlay ${overlay.id}: tipo inválido`;
    if (
      !isNonNegInt(overlay.startUs) ||
      !isNonNegInt(overlay.endUs) ||
      overlay.endUs <= overlay.startUs
    ) {
      return `Overlay ${overlay.id}: intervalo inválido`;
    }
    const geometryError = validateOverlayGeometry(overlay.geometry);
    if (geometryError) return `Overlay ${overlay.id}: ${geometryError}`;
    if (overlay.kind === "text") {
      const error = validateOverlayText(overlay.text) ?? validateOverlayStyle(overlay.style);
      if (error) return `Overlay ${overlay.id}: ${error}`;
    }
    if (overlay.kind === "image") {
      if (!assetsById.has(overlay.assetId)) {
        return `Overlay ${overlay.id} referencia un asset inexistente`;
      }
      if (assetsById.get(overlay.assetId).metadata?.durationUs != null) {
        return `Overlay ${overlay.id} debe usar una imagen, no un video`;
      }
    }
  }
  return null;
}

export function validateEditorProject(data) {
  if (!data || typeof data !== "object" || Array.isArray(data))
    return fail("El proyecto debe ser un objeto");
  if (data.type !== EDIT_PROJECT_TYPE) return fail("Tipo de documento inválido");
  if (data.version !== EDIT_PROJECT_VERSION) {
    return fail(`Versión de proyecto no soportada: ${data.version}`);
  }
  if (!isNonEmptyString(data.name)) return fail("Campo requerido faltante: name");
  if (!isNonNegInt(data.revision)) return fail("revision debe ser un entero mayor o igual que 0");
  if (!isPositiveInt(data.fps?.num) || !isPositiveInt(data.fps?.den)) return fail("fps inválido");
  if (
    data.fps.num / data.fps.den < COMPOSITION_LIMITS.minFps ||
    data.fps.num / data.fps.den > COMPOSITION_LIMITS.maxFps
  )
    return fail("fps fuera de rango");
  const canvasError = validateCompositionCanvas(data.canvas);
  if (canvasError) return fail(canvasError);
  for (const key of ["assets", "tracks", "clips", "overlays"]) {
    if (!Array.isArray(data[key])) return fail(`${key} debe ser un array`);
  }
  if (data.clips.length > COMPOSITION_LIMITS.maxClips)
    return fail(`La composición supera ${COMPOSITION_LIMITS.maxClips} clips`);
  if (data.tracks.length === 0) return fail("El proyecto necesita al menos una pista");

  for (const asset of data.assets) {
    const error = checkAssetIdentity(asset);
    if (error) return fail(error);
  }
  const idError = checkUniqueIds(data);
  if (idError) return fail(idError);

  const assetsById = new Map(data.assets.map((a) => [a.id, a]));
  const tracksById = new Map(data.tracks.map((t) => [t.id, t]));
  const clipsById = new Map(data.clips.map((clip) => [clip.id, clip]));
  const error =
    checkClips(data, assetsById, tracksById) ??
    checkTrackMembership(data, clipsById) ??
    checkOverlays(data, assetsById);
  return error ? fail(error) : { valid: true };
}

export function parseEditorProject(data) {
  const result = validateEditorProject(data);
  return result.valid ? { ok: true, project: data } : { ok: false, error: result.error };
}

export function assertEditorProject(data) {
  const result = validateEditorProject(data);
  if (!result.valid) throw new EditorError(result.error);
  return data;
}
