import { clampRegionToVideo, isRegionUsable } from "./video-utils";
import { ensureNormalized } from "./types";
import { pickTextStyle } from "./text-style";
import { clampNum } from "./clamp";
import { VALID_DELOGO_METHODS } from "./delogo-ops";

const MAX_LABEL_LEN = 64;
const MAX_TEXT_INPUT_LEN = 2000;

function clampBool(val, fallback = false) {
  return typeof val === "boolean" ? val : fallback;
}

export function sanitizeTemplateRegions(regions) {
  if (!Array.isArray(regions)) return [];
  const out = [];
  for (const raw of regions) {
    if (!raw || typeof raw !== "object") continue;
    const normalized = ensureNormalized(raw.region);
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
    textFontSize: clampNum(textStyle.textFontSize, 8, 200, 32),
    textFontColor: String(textStyle.textFontColor ?? "white").slice(0, 32),
    fontFamily: String(textStyle.fontFamily ?? "Arial").slice(0, 64),
    fontWeight: clampNum(textStyle.fontWeight, 100, 900, 400),
    letterSpacing: clampNum(textStyle.letterSpacing, 0, 80, 0),
    textAlign: ["left", "center", "right"].includes(textStyle.textAlign)
      ? textStyle.textAlign
      : "left",
    textOpacity: clampNum(textStyle.textOpacity, 0, 1, 1),
    bold: clampBool(textStyle.bold),
    italic: clampBool(textStyle.italic),
    bgEnabled: clampBool(textStyle.bgEnabled, true),
    bgColor: String(textStyle.bgColor ?? "black").slice(0, 32),
    bgOpacity: clampNum(textStyle.bgOpacity, 0, 1, 0.65),
    boxBorderWidth: clampNum(textStyle.boxBorderWidth, 0, 48, 4),
    borderWidth: clampNum(textStyle.borderWidth, 0, 24, 0),
    borderColor: String(textStyle.borderColor ?? "black").slice(0, 32),
  };
}
export function sanitizeDefaults(defaults = {}) {
  return {
    blurStrength: clampNum(defaults.blurStrength, 1, 100, 20),
    delogoMethod: VALID_DELOGO_METHODS.has(defaults.delogoMethod) ? defaults.delogoMethod : "temporal",
    delogoFillColor: String(defaults.delogoFillColor ?? "black").slice(0, 32),
    delogoFillOpacity: clampNum(defaults.delogoFillOpacity, 0, 1, 1),
    temporalRadius: clampNum(defaults.temporalRadius, 1, 30, 5),
    mosaicSize: clampNum(defaults.mosaicSize, 2, 64, 8),
    mirrorSide: ["left", "right", "top", "bottom"].includes(defaults.mirrorSide)
      ? defaults.mirrorSide
      : "right",
    edgeFeather: clampNum(defaults.edgeFeather, 0, 32, 0),
  };
}