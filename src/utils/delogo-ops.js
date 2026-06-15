/** Delogo operation sanitization (no UI). Used before FFmpeg job export. */

import { clampNum } from "./clamp";

export const VALID_DELOGO_METHODS = new Set([
  "temporal",
  "mirror",
  "mosaic",
  "inpaint",
  "blur",
  "fill",
  "cover",
]);

export function sanitizeDelogoMethod(method) {
  const m = String(method || "temporal").toLowerCase();
  return VALID_DELOGO_METHODS.has(m) ? m : "temporal";
}

export function sanitizeOperation(op) {
  if (!op || typeof op !== "object") return op;
  const out = { ...op };
  if (out.mode !== "delogo") return out;

  if (out.simpleDelogo) {
    // Simple/auto mode: force a single reasonable blur and discard method-specific extras.
    out.delogoMethod = "blur";
    out.blurStrength = clampNum(out.blurStrength, 5, 30, 20);
    delete out.temporalRadius;
    delete out.mosaicSize;
    delete out.edgeFeather;
    delete out.mirrorSide;
    delete out.delogoFillColor;
    delete out.delogoFillOpacity;
    delete out.delogoImagePath;
    return out;
  }

  out.delogoMethod = sanitizeDelogoMethod(out.delogoMethod);
  out.temporalRadius = clampNum(out.temporalRadius, 1, 15, 3);
  out.mosaicSize = clampNum(out.mosaicSize, 4, 80, 12);
  out.edgeFeather = clampNum(out.edgeFeather, 0, 40, 6);
  out.blurStrength = clampNum(out.blurStrength, 1, 100, 20);

  // Cover requires a non-empty image path; fall back to temporal otherwise.
  if (
    out.delogoMethod === "cover" &&
    (typeof out.delogoImagePath !== "string" || !out.delogoImagePath.trim())
  ) {
    out.delogoMethod = "temporal";
  }

  const side = String(out.mirrorSide || "right").toLowerCase();
  out.mirrorSide = ["left", "right", "top", "bottom"].includes(side) ? side : "right";

  if (typeof out.delogoFillColor !== "string" || !out.delogoFillColor) {
    out.delogoFillColor = "black";
  }
  const fo = Number(out.delogoFillOpacity);
  out.delogoFillOpacity = Number.isFinite(fo) ? Math.max(0, Math.min(1, fo)) : 1;

  return out;
}
