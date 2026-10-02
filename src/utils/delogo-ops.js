import { clampNum } from "./clamp";
import { DELOGO_METHODS, MIRROR_SIDES as MIRROR_SIDES_UI, denormalizeRegion } from "./types";

export const VALID_DELOGO_METHODS = new Set(DELOGO_METHODS.map((m) => m.id));

const MIRROR_SIDE_IDS = MIRROR_SIDES_UI.map((s) => s.id);

export const DELOGO_FIELD_BOUNDS = {
  temporalRadius: { min: 1, max: 15, default: 3 },
  mosaicSize: { min: 4, max: 80, default: 12 },
  edgeFeather: { min: 0, max: 40, default: 6 },
  blurStrength: { min: 1, max: 100, default: 20 },
};

function sanitizeDelogoMethod(method) {
  const m = String(method || "blur").toLowerCase();
  return VALID_DELOGO_METHODS.has(m) ? m : "blur";
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
  for (const [field, bounds] of Object.entries(DELOGO_FIELD_BOUNDS)) {
    out[field] = clampNum(out[field], bounds.min, bounds.max, bounds.default);
  }

  if (
    out.delogoMethod === "cover" &&
    (typeof out.delogoImagePath !== "string" || !out.delogoImagePath.trim())
  ) {
    out.delogoMethod = "blur";
  }

  out.mirrorSide = sanitizeMirrorSide(out.mirrorSide);

  if (typeof out.delogoFillColor !== "string" || !out.delogoFillColor) {
    out.delogoFillColor = "black";
  }
  const fo = Number(out.delogoFillOpacity);
  out.delogoFillOpacity = Number.isFinite(fo) ? Math.max(0, Math.min(1, fo)) : 1;

  return out;
}

export function buildLogoPreviewJob(job, draft) {
  if (!job || !draft || !["blur", "delogo", "crop"].includes(draft.mode)) return job;
  const { x, y, w, h } = draft.region || {};
  if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return job;
  if (!(job.width > 0 && job.height > 0)) return job;

  const safe = sanitizeOperation(draft);
  const operation = {
    mode: safe.mode,
    region: denormalizeRegion(safe.region, job.width, job.height),
    start_time: safe.startTime ?? null,
    end_time: safe.endTime ?? null,
  };
  if (safe.mode === "delogo") {
    Object.assign(operation, {
      delogo_method: safe.delogoMethod,
      blur_strength: safe.blurStrength,
      edge_feather: safe.edgeFeather,
      temporal_radius: safe.temporalRadius,
      mosaic_size: safe.mosaicSize,
      mirror_side: safe.mirrorSide,
      delogo_fill_color: safe.delogoFillColor,
      delogo_fill_opacity: safe.delogoFillOpacity,
      delogo_image_path: safe.delogoImagePath,
    });
  }
  if (safe.mode === "blur") operation.blur_strength = safe.blurStrength;
  return { ...job, operations: [...job.operations, operation] };
}
