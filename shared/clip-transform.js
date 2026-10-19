import { COMPOSITION_LIMITS } from "./composition-settings.js";

const SPEED_MIN = COMPOSITION_LIMITS.minRate;
const SPEED_MAX = COMPOSITION_LIMITS.maxRate;
const ZOOM_MIN = 1;
const ZOOM_MAX = 4;
const ROTATIONS = new Set([0, 90, 180, 270]);
const FIT_MODES = new Set(["fit", "fill"]);
const MIN_CROP = 0.05;

export const DEFAULT_CLIP_TRANSFORM = Object.freeze({
  rotate: 0,
  flipH: false,
  flipV: false,
  crop: Object.freeze({ x: 0, y: 0, w: 1, h: 1 }),
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
  fit: "fit",
});

const isNumberIn = (value, low, high) => typeof value === "number" && value >= low && value <= high;

export function validateClipTransform(transform) {
  if (!transform || typeof transform !== "object") return "Transformación inválida";
  if (!ROTATIONS.has(transform.rotate)) return "La rotación debe ser 0, 90, 180 o 270";
  if (typeof transform.flipH !== "boolean" || typeof transform.flipV !== "boolean") {
    return "Los volteos deben ser booleanos";
  }
  if (!FIT_MODES.has(transform.fit)) return "El ajuste debe ser fit o fill";
  if (!isNumberIn(transform.zoom, ZOOM_MIN, ZOOM_MAX)) return "El zoom está fuera de rango";
  if (!isNumberIn(transform.offsetX, -1, 1) || !isNumberIn(transform.offsetY, -1, 1)) {
    return "El desplazamiento está fuera de rango";
  }
  const crop = transform.crop;
  if (!crop || typeof crop !== "object") return "El recorte es inválido";
  if (!isNumberIn(crop.x, 0, 1) || !isNumberIn(crop.y, 0, 1))
    return "El recorte empieza fuera del video";
  if (!isNumberIn(crop.w, MIN_CROP, 1) || !isNumberIn(crop.h, MIN_CROP, 1))
    return "El recorte es demasiado pequeño";
  if (crop.x + crop.w > 1 + 1e-9 || crop.y + crop.h > 1 + 1e-9) return "El recorte sale del video";
  return null;
}

export function validateClipSpeed(speed) {
  return isNumberIn(speed, SPEED_MIN, SPEED_MAX)
    ? null
    : "La velocidad debe estar entre 0,25x y 4x";
}

export function normalizeClipTransform(transform = {}) {
  return {
    ...DEFAULT_CLIP_TRANSFORM,
    ...transform,
    crop: { ...DEFAULT_CLIP_TRANSFORM.crop, ...(transform.crop ?? {}) },
  };
}

export function clipLayerGeometry(transform, source, canvas) {
  const t = normalizeClipTransform(transform);
  const x0 = t.crop.x * source.width;
  const y0 = t.crop.y * source.height;
  const w0 = t.crop.w * source.width;
  const h0 = t.crop.h * source.height;
  const sideways = t.rotate === 90 || t.rotate === 270;
  const w1 = sideways ? h0 : w0;
  const h1 = sideways ? w0 : h0;
  const contain = Math.min(canvas.width / w1, canvas.height / h1);
  const cover = Math.max(canvas.width / w1, canvas.height / h1);
  const scale = (t.fit === "fill" ? cover : contain) * t.zoom;
  const width = w1 * scale;
  const height = h1 * scale;
  const left = (canvas.width - width) / 2 + t.offsetX * canvas.width;
  const top = (canvas.height - height) / 2 + t.offsetY * canvas.height;

  const toFrame = (u, v) => {
    const p = u - x0;
    const q = v - y0;
    let x = p;
    let y = q;
    if (t.rotate === 90) [x, y] = [h0 - q, p];
    else if (t.rotate === 180) [x, y] = [w0 - p, h0 - q];
    else if (t.rotate === 270) [x, y] = [q, w0 - p];
    if (t.flipH) x = w1 - x;
    if (t.flipV) y = h1 - y;
    return [x * scale, y * scale];
  };
  const [e, f] = toFrame(0, 0);
  const [xu, yu] = toFrame(1, 0);
  const [xv, yv] = toFrame(0, 1);
  return {
    frame: { left, top, width, height },
    source: { width: source.width, height: source.height },
    matrix: [xu - e, yu - f, xv - e, yv - f, e, f],
  };
}
