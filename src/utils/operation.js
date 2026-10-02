import { uid, denormalizeRegion } from "./types.js";
import { TEXT_STYLE_DEFAULTS, textStyleToPythonPayload } from "./text-style.js";
import { sanitizeOperation } from "./delogo-ops.js";

export function createOperation(overrides = {}) {
  return {
    id: uid(),
    mode: "blur",
    region: null,
    blurStrength: 20,
    delogoMethod: "blur",
    delogoFillColor: "black",
    delogoFillOpacity: 1,
    delogoImagePath: "",
    startTime: null,
    endTime: null,
    text: "",
    batchRegionId: null,
    ...TEXT_STYLE_DEFAULTS,
    imagePath: "",
    imageOpacity: 1,
    ...overrides,
  };
}

const DECIMAL_BOUND = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

function timeBound(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value !== "string") return null;
  const s = value.trim();
  return DECIMAL_BOUND.test(s) ? Number(s) : null;
}

export function isOpActive(op, t) {
  const s = timeBound(op.startTime);
  const e = timeBound(op.endTime);
  if (s === null && e === null) return true;
  if (s !== null && e !== null && e <= s) return false;
  if (s !== null && t < s) return false;
  if (e !== null && t > e) return false;
  return true;
}

export function filterOperationsForExport(operations) {
  if (!Array.isArray(operations)) return [];
  return operations.filter((op) => {
    if (op?.mode === "text") return String(op.text ?? "").trim().length > 0;
    if (op?.mode === "image") return String(op.imagePath ?? "").trim().length > 0;
    return true;
  });
}

export function operationToJobPayload(op, width, height) {
  const safe = sanitizeOperation(op);
  return {
    mode: safe.mode,
    region:
      safe.region && width > 0 && height > 0
        ? denormalizeRegion(safe.region, width, height)
        : safe.region,
    blur_strength: safe.blurStrength,
    delogo_method: safe.delogoMethod,
    delogo_fill_color: safe.delogoFillColor,
    delogo_fill_opacity: safe.delogoFillOpacity,
    delogo_image_path: safe.delogoImagePath,
    temporal_radius: safe.temporalRadius,
    mosaic_size: safe.mosaicSize,
    mirror_side: safe.mirrorSide,
    edge_feather: safe.edgeFeather,
    text: safe.text,
    ...textStyleToPythonPayload(safe),
    image_path: safe.imagePath,
    image_opacity: safe.imageOpacity,
    start_time: safe.startTime,
    end_time: safe.endTime,
  };
}

export function operationsToJobPayload(operations, width, height) {
  return filterOperationsForExport(operations).map((op) =>
    operationToJobPayload(op, width, height),
  );
}
