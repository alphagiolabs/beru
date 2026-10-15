import limits from "../resources/composition-limits.json" with { type: "json" };
import {
  OVERLAY_MAX_COUNT,
  validateOverlayGeometry,
  validateOverlayStyle,
  validateOverlayText,
} from "./overlay-style.js";

export const COMPOSITION_LIMITS = Object.freeze(limits);
export const COMPOSITION_FITS = new Set(["contain", "cover"]);
export const absoluteMediaPath = (value) =>
  typeof value === "string" &&
  (/^[A-Za-z]:[\\/]/.test(value) || value.startsWith("/") || value.startsWith("\\\\"));

export function validateCompositionCanvas(canvas) {
  for (const [key, label] of [
    ["width", "ancho"],
    ["height", "alto"],
  ]) {
    const value = canvas?.[key];
    if (
      !Number.isInteger(value) ||
      value < limits.minCanvasDimension ||
      value > limits.maxCanvasDimension
    )
      return `canvas: ${label} inválido`;
    if (value % 2) return "canvas: las dimensiones deben ser pares";
  }
  if (!COMPOSITION_FITS.has(canvas.fit ?? "contain")) return "canvas: ajuste inválido";
  if (!/^#[0-9a-fA-F]{6}$/.test(canvas.background ?? "#000000"))
    return "canvas: color de fondo inválido";
  return null;
}

export function validateCompositionFraming(value) {
  if (!value || typeof value !== "object") return "Encuadre inválido";
  const inRange = (n, min, max) => typeof n === "number" && n >= min && n <= max;
  if (!COMPOSITION_FITS.has(value.fit)) return "Ajuste inválido";
  if (!inRange(value.zoom, 1, 4)) return "Zoom fuera de rango";
  if (!inRange(value.offsetX, -1, 1) || !inRange(value.offsetY, -1, 1))
    return "Desplazamiento fuera de rango";
  const c = value.crop;
  if (
    !c ||
    !inRange(c.x, 0, 1) ||
    !inRange(c.y, 0, 1) ||
    !inRange(c.w, 0.05, 1) ||
    !inRange(c.h, 0.05, 1) ||
    c.x + c.w > 1 + 1e-9 ||
    c.y + c.h > 1 + 1e-9
  )
    return "Recorte fuera de rango";
  return null;
}

export function validateCompositionOverlay(overlay) {
  if (!overlay || !["text", "image"].includes(overlay.kind))
    return "Tipo de superposición inválido";
  if (
    !Number.isSafeInteger(overlay.startUs) ||
    !Number.isSafeInteger(overlay.endUs) ||
    overlay.startUs < 0 ||
    overlay.endUs <= overlay.startUs
  )
    return "Intervalo de superposición inválido";
  const geometry = validateOverlayGeometry(overlay.geometry);
  if (geometry) return geometry;
  if (overlay.kind === "text")
    return validateOverlayText(overlay.text) ?? validateOverlayStyle(overlay.style);
  return absoluteMediaPath(overlay.source?.path) ? null : "La ruta de la imagen debe ser absoluta";
}

export function validateCompositionJob(job) {
  if (job?.kind !== "composition") return "Tipo de composición inválido";
  const canvasError = validateCompositionCanvas(job.canvas);
  if (canvasError) return canvasError;
  if (
    !Number.isFinite(job.composition_fps) ||
    job.composition_fps < limits.minFps ||
    job.composition_fps > limits.maxFps
  )
    return "fps fuera de rango";
  if (!Array.isArray(job.clips) || !job.clips.length) return "La composición no tiene clips";
  if (job.clips.length > limits.maxClips) return `La composición supera ${limits.maxClips} clips`;
  let duration = 0;
  for (const clip of job.clips) {
    if (!clip || (clip.kind != null && clip.kind !== "video"))
      return "Entrada de composición inválida";
    if (!absoluteMediaPath(clip.input_path)) return "La ruta de la fuente debe ser absoluta";
    const start = clip.trim_start ?? 0,
      end = clip.trim_end ?? clip.video_duration;
    if (
      ![start, end].every(Number.isFinite) ||
      start < 0 ||
      end <= start ||
      end > clip.video_duration
    )
      return "Intervalo de fuente inválido";
    const rate = clip.playback_rate ?? 1,
      repeat = clip.repeat_count ?? 1;
    if (!Number.isFinite(rate) || rate < limits.minRate || rate > limits.maxRate)
      return "Velocidad fuera de rango";
    if (!Number.isInteger(repeat) || repeat < 1 || repeat > limits.maxRepeatCount)
      return "Repeticiones fuera de rango";
    if (clip.framing != null) {
      const error = validateCompositionFraming(clip.framing);
      if (error) return error;
    }
    if (clip.audio_muted != null && typeof clip.audio_muted !== "boolean")
      return "Silencio inválido";
    duration +=
      Math.ceil(((end - start) / rate) * repeat * job.composition_fps - 1e-8) / job.composition_fps;
  }
  const overlays = job.overlays ?? [];
  if (!Array.isArray(overlays) || overlays.length > OVERLAY_MAX_COUNT)
    return "Superposiciones fuera de rango";
  for (const overlay of overlays) {
    const error = validateCompositionOverlay(overlay);
    if (error) return error;
    duration = Math.max(duration, overlay.endUs / 1e6);
  }
  if (duration > limits.maxDurationSeconds) return "La composición supera la duración máxima";
  if (
    job.frame != null &&
    (!Number.isSafeInteger(job.frame.atUs) ||
      job.frame.atUs < 0 ||
      job.frame.atUs >= duration * 1e6)
  )
    return "El instante del fotograma está fuera del montaje";
  return null;
}
