import { clampRegionToVideo, isRegionUsable } from "./video-utils";
import { ensureNormalized, isNormalizedRegion } from "./types";
import { hydrateGlobalTextStyle, pickTextStyle } from "./text-style";
import { clampNum } from "./clamp";
import { VALID_DELOGO_METHODS, DELOGO_FIELD_BOUNDS, sanitizeMirrorSide } from "./delogo-ops";

const MAX_LABEL_LEN = 64;
const MAX_TEXT_INPUT_LEN = 2000;
const PRESET_REGION_FALLBACK_WIDTH = 1920;
const PRESET_REGION_FALLBACK_HEIGHT = 1080;

export function sanitizeTemplateRegions(regions) {
  if (!Array.isArray(regions)) return [];
  const out = [];
  for (const raw of regions) {
    if (!raw || typeof raw !== "object") continue;
    if (!isNormalizedRegion(raw.region)) {
      const { x, y, w, h } = raw.region || {};
      if (![x, y, w, h].every(Number.isFinite)) continue;
      if (
        Math.abs(w) > PRESET_REGION_FALLBACK_WIDTH ||
        Math.abs(h) > PRESET_REGION_FALLBACK_HEIGHT ||
        Math.abs(x) > PRESET_REGION_FALLBACK_WIDTH ||
        Math.abs(y) > PRESET_REGION_FALLBACK_HEIGHT
      ) {
        continue;
      }
    }
    const normalized = ensureNormalized(
      raw.region,
      PRESET_REGION_FALLBACK_WIDTH,
      PRESET_REGION_FALLBACK_HEIGHT,
    );
    const region = clampRegionToVideo(normalized);
    if (!region || !isRegionUsable(region)) continue;
    const id = Number.isFinite(Number(raw.id)) ? Number(raw.id) : Date.now() + out.length;
    out.push({
      id,
      label: String(raw.label ?? "TEXT").slice(0, MAX_LABEL_LEN),
      region,
      style: raw.style ? pickTextStyle(raw.style) : undefined,
    });
  }
  return out;
}

export function sanitizeTextStyle(textStyle = {}) {
  return {
    textInput: String(textStyle.textInput ?? "").slice(0, MAX_TEXT_INPUT_LEN),
    ...hydrateGlobalTextStyle(textStyle),
  };
}
export function persistWatermark(wm) {
  if (!wm || typeof wm !== "object") return null;
  return {
    enabled: !!wm.enabled,
    type: wm.type === "image" ? "image" : "text",
    text: typeof wm.text === "string" ? wm.text : "",
    imagePath: typeof wm.imagePath === "string" ? wm.imagePath : "",
    opacity: Number.isFinite(Number(wm.opacity)) ? Number(wm.opacity) : 0.5,
    scale: Number.isFinite(Number(wm.scale)) ? Number(wm.scale) : 1,
    position: typeof wm.position === "string" ? wm.position : "bottom-right",
    fontSize: Number.isFinite(Number(wm.fontSize)) ? Number(wm.fontSize) : 18,
    fontColor: typeof wm.fontColor === "string" ? wm.fontColor : "#ffffff",
    fontFamily: typeof wm.fontFamily === "string" ? wm.fontFamily : "Arial",
  };
}

export function restoreWatermark(wm) {
  const persisted = persistWatermark(wm);
  if (!persisted) return null;
  return { ...persisted, imageDataUrl: "" };
}

export function sanitizeDefaults(defaults = {}) {
  return {
    blurStrength: clampNum(
      defaults.blurStrength,
      DELOGO_FIELD_BOUNDS.blurStrength.min,
      DELOGO_FIELD_BOUNDS.blurStrength.max,
      DELOGO_FIELD_BOUNDS.blurStrength.default,
    ),
    delogoMethod: VALID_DELOGO_METHODS.has(defaults.delogoMethod) ? defaults.delogoMethod : "blur",
    delogoFillColor: String(defaults.delogoFillColor ?? "black").slice(0, 32),
    delogoFillOpacity: clampNum(defaults.delogoFillOpacity, 0, 1, 1),
    delogoImagePath: typeof defaults.delogoImagePath === "string" ? defaults.delogoImagePath : "",
    temporalRadius: clampNum(
      defaults.temporalRadius,
      DELOGO_FIELD_BOUNDS.temporalRadius.min,
      DELOGO_FIELD_BOUNDS.temporalRadius.max,
      DELOGO_FIELD_BOUNDS.temporalRadius.default,
    ),
    mosaicSize: clampNum(
      defaults.mosaicSize,
      DELOGO_FIELD_BOUNDS.mosaicSize.min,
      DELOGO_FIELD_BOUNDS.mosaicSize.max,
      DELOGO_FIELD_BOUNDS.mosaicSize.default,
    ),
    mirrorSide: sanitizeMirrorSide(defaults.mirrorSide),
    edgeFeather: clampNum(
      defaults.edgeFeather,
      DELOGO_FIELD_BOUNDS.edgeFeather.min,
      DELOGO_FIELD_BOUNDS.edgeFeather.max,
      DELOGO_FIELD_BOUNDS.edgeFeather.default,
    ),
  };
}
