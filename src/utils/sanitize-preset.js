import { clampRegionToVideo, isRegionUsable } from "./video-utils";
import { ensureNormalized, isNormalizedRegion } from "./types";
import { normalizeTextStyle, pickTextStyle } from "./text-style";
import { clampNum } from "./clamp";
import { VALID_DELOGO_METHODS } from "./delogo-ops";

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
  const style = normalizeTextStyle({
    fontSize: textStyle.textFontSize,
    fontColor: textStyle.textFontColor,
    fontFamily: textStyle.fontFamily,
    fontWeight: textStyle.fontWeight,
    letterSpacing: textStyle.letterSpacing,
    textAlign: textStyle.textAlign,
    textOpacity: textStyle.textOpacity,
    bold: textStyle.bold,
    italic: textStyle.italic,
    bgEnabled: textStyle.bgEnabled,
    bgColor: textStyle.bgColor,
    bgOpacity: textStyle.bgOpacity,
    boxBorderWidth: textStyle.boxBorderWidth,
    borderWidth: textStyle.borderWidth,
    borderColor: textStyle.borderColor,
    textShadowEnabled: textStyle.textShadowEnabled,
    textShadowColor: textStyle.textShadowColor,
    textShadowOffsetX: textStyle.textShadowOffsetX,
    textShadowOffsetY: textStyle.textShadowOffsetY,
  });
  return {
    textInput: String(textStyle.textInput ?? "").slice(0, MAX_TEXT_INPUT_LEN),
    textFontSize: style.fontSize,
    textFontColor: style.fontColor,
    fontFamily: style.fontFamily,
    fontWeight: style.fontWeight,
    letterSpacing: style.letterSpacing,
    textAlign: style.textAlign,
    textOpacity: style.textOpacity,
    bold: style.bold,
    italic: style.italic,
    bgEnabled: style.bgEnabled,
    bgColor: style.bgColor,
    bgOpacity: style.bgOpacity,
    boxBorderWidth: style.boxBorderWidth,
    borderWidth: style.borderWidth,
    borderColor: style.borderColor,
    textShadowEnabled: style.textShadowEnabled,
    textShadowColor: style.textShadowColor,
    textShadowOffsetX: style.textShadowOffsetX,
    textShadowOffsetY: style.textShadowOffsetY,
  };
}
export function sanitizeDefaults(defaults = {}) {
  return {
    blurStrength: clampNum(defaults.blurStrength, 1, 100, 20),
    delogoMethod: VALID_DELOGO_METHODS.has(defaults.delogoMethod)
      ? defaults.delogoMethod
      : "temporal",
    delogoFillColor: String(defaults.delogoFillColor ?? "black").slice(0, 32),
    delogoFillOpacity: clampNum(defaults.delogoFillOpacity, 0, 1, 1),
    delogoImagePath: typeof defaults.delogoImagePath === "string" ? defaults.delogoImagePath : "",
    temporalRadius: clampNum(defaults.temporalRadius, 1, 30, 5),
    mosaicSize: clampNum(defaults.mosaicSize, 2, 64, 8),
    mirrorSide: ["left", "right", "top", "bottom"].includes(defaults.mirrorSide)
      ? defaults.mirrorSide
      : "right",
    edgeFeather: clampNum(defaults.edgeFeather, 0, 32, 0),
  };
}
