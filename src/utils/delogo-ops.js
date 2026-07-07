/** Delogo operation sanitization (no UI). Used before FFmpeg job export. */

import { clampNum } from "./clamp";
import { DELOGO_METHODS, MIRROR_SIDES as MIRROR_SIDES_UI } from "./types";

export const VALID_DELOGO_METHODS = new Set(DELOGO_METHODS.map((m) => m.id));

const MIRROR_SIDE_IDS = MIRROR_SIDES_UI.map((s) => s.id);

/**
 * Single source of truth for delogo field bounds and defaults.
 * Shared by `sanitizeOperation` (export path) and `sanitizeDefaults`
 * (preset load path) so preview and export never disagree.
 */
export const DELOGO_FIELD_BOUNDS = {
  temporalRadius: { min: 1, max: 15, default: 3 },
  mosaicSize: { min: 4, max: 80, default: 12 },
  edgeFeather: { min: 0, max: 40, default: 6 },
  blurStrength: { min: 1, max: 100, default: 20 },
};

function sanitizeDelogoMethod(method) {
  const m = String(method || "temporal").toLowerCase();
  return VALID_DELOGO_METHODS.has(m) ? m : "temporal";
}

export function sanitizeMirrorSide(side) {
  const s = String(side || "right").toLowerCase();
  return MIRROR_SIDE_IDS.includes(s) ? s : "right";
}

export function sanitizeOperation(op) {
  if (!op || typeof op !== "object") return op;
  const out = { ...op };
  if (out.mode !== "delogo") return out;

  out.delogoMethod = sanitizeDelogoMethod(out.delogoMethod);
  out.temporalRadius = clampNum(
    out.temporalRadius,
    DELOGO_FIELD_BOUNDS.temporalRadius.min,
    DELOGO_FIELD_BOUNDS.temporalRadius.max,
    DELOGO_FIELD_BOUNDS.temporalRadius.default,
  );
  out.mosaicSize = clampNum(
    out.mosaicSize,
    DELOGO_FIELD_BOUNDS.mosaicSize.min,
    DELOGO_FIELD_BOUNDS.mosaicSize.max,
    DELOGO_FIELD_BOUNDS.mosaicSize.default,
  );
  out.edgeFeather = clampNum(
    out.edgeFeather,
    DELOGO_FIELD_BOUNDS.edgeFeather.min,
    DELOGO_FIELD_BOUNDS.edgeFeather.max,
    DELOGO_FIELD_BOUNDS.edgeFeather.default,
  );
  out.blurStrength = clampNum(
    out.blurStrength,
    DELOGO_FIELD_BOUNDS.blurStrength.min,
    DELOGO_FIELD_BOUNDS.blurStrength.max,
    DELOGO_FIELD_BOUNDS.blurStrength.default,
  );

  // Cover requires a non-empty image path; fall back to temporal otherwise.
  if (
    out.delogoMethod === "cover" &&
    (typeof out.delogoImagePath !== "string" || !out.delogoImagePath.trim())
  ) {
    out.delogoMethod = "temporal";
  }

  out.mirrorSide = sanitizeMirrorSide(out.mirrorSide);

  if (typeof out.delogoFillColor !== "string" || !out.delogoFillColor) {
    out.delogoFillColor = "black";
  }
  const fo = Number(out.delogoFillOpacity);
  out.delogoFillOpacity = Number.isFinite(fo) ? Math.max(0, Math.min(1, fo)) : 1;

  return out;
}
