/** Shared text style shape for preview overlays, projects, batch jobs, and FFmpeg export. */

import { clampNum } from "./clamp";
import { LETTER_SPACING_MAX, LETTER_SPACING_MIN } from "./letter-spacing";

const TEXT_STYLE_KEYS = [
  "fontSize",
  "fontColor",
  "fontFamily",
  "fontWeight",
  "letterSpacing",
  "textAlign",
  "textOpacity",
  "bold",
  "italic",
  "bgEnabled",
  "bgColor",
  "bgOpacity",
  "boxBorderWidth",
  "borderWidth",
  "borderColor",
  "textShadowEnabled",
  "textShadowColor",
  "textShadowOffsetX",
  "textShadowOffsetY",
  "autoFit",
  "lineHeight",
  "verticalAlign",
  "textWrap",
  "safeMargin",
  "truncate",
];

const GLOBAL_KEY_MAP = {
  fontSize: "textFontSize",
  fontColor: "textFontColor",
};

export const TEXT_STYLE_DEFAULTS = Object.freeze({
  fontSize: 32,
  fontColor: "white",
  fontFamily: "Arial",
  fontWeight: 400,
  letterSpacing: 0,
  textAlign: "left",
  textOpacity: 1,
  bold: false,
  italic: false,
  bgEnabled: true,
  bgColor: "black",
  bgOpacity: 0.65,
  boxBorderWidth: 4,
  borderWidth: 0,
  borderColor: "black",
  textShadowEnabled: false,
  textShadowColor: "black",
  textShadowOffsetX: 2,
  textShadowOffsetY: 2,
  autoFit: false,
  lineHeight: 1.2,
  verticalAlign: "top",
  textWrap: true,
  safeMargin: 4,
  truncate: "none",
});

export const GLOBAL_TEXT_STYLE_DEFAULTS = Object.freeze({
  textInput: "Sample Text",
  textFontSize: TEXT_STYLE_DEFAULTS.fontSize,
  textFontColor: TEXT_STYLE_DEFAULTS.fontColor,
  fontFamily: TEXT_STYLE_DEFAULTS.fontFamily,
  fontWeight: TEXT_STYLE_DEFAULTS.fontWeight,
  letterSpacing: TEXT_STYLE_DEFAULTS.letterSpacing,
  textAlign: TEXT_STYLE_DEFAULTS.textAlign,
  textOpacity: TEXT_STYLE_DEFAULTS.textOpacity,
  bold: TEXT_STYLE_DEFAULTS.bold,
  italic: TEXT_STYLE_DEFAULTS.italic,
  bgEnabled: TEXT_STYLE_DEFAULTS.bgEnabled,
  bgColor: TEXT_STYLE_DEFAULTS.bgColor,
  bgOpacity: TEXT_STYLE_DEFAULTS.bgOpacity,
  boxBorderWidth: TEXT_STYLE_DEFAULTS.boxBorderWidth,
  borderWidth: TEXT_STYLE_DEFAULTS.borderWidth,
  borderColor: TEXT_STYLE_DEFAULTS.borderColor,
  textShadowEnabled: TEXT_STYLE_DEFAULTS.textShadowEnabled,
  textShadowColor: TEXT_STYLE_DEFAULTS.textShadowColor,
  textShadowOffsetX: TEXT_STYLE_DEFAULTS.textShadowOffsetX,
  textShadowOffsetY: TEXT_STYLE_DEFAULTS.textShadowOffsetY,
  autoFit: TEXT_STYLE_DEFAULTS.autoFit,
  lineHeight: TEXT_STYLE_DEFAULTS.lineHeight,
  verticalAlign: TEXT_STYLE_DEFAULTS.verticalAlign,
  textWrap: TEXT_STYLE_DEFAULTS.textWrap,
  safeMargin: TEXT_STYLE_DEFAULTS.safeMargin,
  truncate: TEXT_STYLE_DEFAULTS.truncate,
});

function clampBool(val, fallback = false) {
  return typeof val === "boolean" ? val : fallback;
}

export function pickTextStyle(obj) {
  if (!obj) return {};
  const out = {};
  for (const k of TEXT_STYLE_KEYS) {
    if (obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
}

export function normalizeTextStyle(style = {}, defaults = TEXT_STYLE_DEFAULTS) {
  const source = { ...defaults, ...pickTextStyle(style) };
  return {
    fontSize: clampNum(source.fontSize, 8, 200, defaults.fontSize),
    fontColor: String(source.fontColor ?? defaults.fontColor).slice(0, 32),
    fontFamily: String(source.fontFamily ?? defaults.fontFamily).slice(0, 64),
    fontWeight: clampNum(source.fontWeight, 100, 900, defaults.fontWeight),
    letterSpacing: clampNum(
      source.letterSpacing,
      LETTER_SPACING_MIN,
      LETTER_SPACING_MAX,
      defaults.letterSpacing,
    ),
    textAlign: ["left", "center", "right"].includes(source.textAlign)
      ? source.textAlign
      : defaults.textAlign,
    textOpacity: clampNum(source.textOpacity, 0, 1, defaults.textOpacity),
    bold: clampBool(source.bold, defaults.bold),
    italic: clampBool(source.italic, defaults.italic),
    bgEnabled: clampBool(source.bgEnabled, defaults.bgEnabled),
    bgColor: String(source.bgColor ?? defaults.bgColor).slice(0, 32),
    bgOpacity: clampNum(source.bgOpacity, 0, 1, defaults.bgOpacity),
    boxBorderWidth: clampNum(source.boxBorderWidth, 0, 48, defaults.boxBorderWidth),
    borderWidth: clampNum(source.borderWidth, 0, 24, defaults.borderWidth),
    borderColor: String(source.borderColor ?? defaults.borderColor).slice(0, 32),
    textShadowEnabled: clampBool(source.textShadowEnabled, defaults.textShadowEnabled),
    textShadowColor: String(source.textShadowColor ?? defaults.textShadowColor).slice(0, 32),
    textShadowOffsetX: clampNum(source.textShadowOffsetX, -64, 64, defaults.textShadowOffsetX),
    textShadowOffsetY: clampNum(source.textShadowOffsetY, -64, 64, defaults.textShadowOffsetY),
    autoFit: clampBool(source.autoFit, defaults.autoFit),
    lineHeight: clampNum(source.lineHeight, 0.8, 3, defaults.lineHeight),
    verticalAlign: ["top", "center", "bottom"].includes(source.verticalAlign)
      ? source.verticalAlign
      : defaults.verticalAlign,
    textWrap: clampBool(source.textWrap, defaults.textWrap),
    safeMargin: clampNum(source.safeMargin, 0, 48, defaults.safeMargin),
    truncate: ["none", "ellipsis", "clip"].includes(source.truncate)
      ? source.truncate
      : defaults.truncate,
  };
}

export function getGlobalTextStyleFromState(s) {
  return normalizeTextStyle({
    fontSize: s.textFontSize,
    fontColor: s.textFontColor,
    fontFamily: s.fontFamily,
    fontWeight: s.fontWeight,
    letterSpacing: s.letterSpacing,
    textAlign: s.textAlign,
    textOpacity: s.textOpacity,
    bold: s.bold,
    italic: s.italic,
    bgEnabled: s.bgEnabled,
    bgColor: s.bgColor,
    bgOpacity: s.bgOpacity,
    boxBorderWidth: s.boxBorderWidth,
    borderWidth: s.borderWidth,
    borderColor: s.borderColor,
    textShadowEnabled: s.textShadowEnabled,
    textShadowColor: s.textShadowColor,
    textShadowOffsetX: s.textShadowOffsetX,
    textShadowOffsetY: s.textShadowOffsetY,
    autoFit: s.autoFit,
    lineHeight: s.lineHeight,
    verticalAlign: s.verticalAlign,
    textWrap: s.textWrap,
    safeMargin: s.safeMargin,
    truncate: s.truncate,
  });
}

export function mergeTextStyles(...layers) {
  return layers.reduce((acc, layer) => ({ ...acc, ...pickTextStyle(layer) }), {});
}

export function textStyleToPythonPayload(style = {}) {
  const safe = normalizeTextStyle(style);
  return {
    font_size: safe.fontSize,
    font_color: safe.fontColor,
    font_family: safe.fontFamily,
    font_weight: safe.fontWeight,
    letter_spacing: safe.letterSpacing,
    text_align: safe.textAlign,
    text_opacity: safe.textOpacity,
    bold: safe.bold,
    italic: safe.italic,
    bg_enabled: safe.bgEnabled,
    bg_color: safe.bgColor,
    bg_opacity: safe.bgOpacity,
    box_border_width: safe.boxBorderWidth,
    border_width: safe.borderWidth,
    border_color: safe.borderColor,
    text_shadow_enabled: safe.textShadowEnabled,
    text_shadow_color: safe.textShadowColor,
    text_shadow_offset_x: safe.textShadowOffsetX,
    text_shadow_offset_y: safe.textShadowOffsetY,
    auto_fit: safe.autoFit,
    line_height: safe.lineHeight,
    vertical_align: safe.verticalAlign,
    text_wrap: safe.textWrap,
    safe_margin: safe.safeMargin,
    truncate: safe.truncate,
  };
}

/** Map operation-style patch keys to global store field names. */
export function patchToGlobalState(patch) {
  const global = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    const gk = GLOBAL_KEY_MAP[k] || k;
    if (
      [
        "textFontSize",
        "textFontColor",
        "fontFamily",
        "fontWeight",
        "letterSpacing",
        "textAlign",
        "textOpacity",
        "bold",
        "italic",
        "bgEnabled",
        "bgColor",
        "bgOpacity",
        "boxBorderWidth",
        "borderWidth",
        "borderColor",
        "textShadowEnabled",
        "textShadowColor",
        "textShadowOffsetX",
        "textShadowOffsetY",
        "autoFit",
        "lineHeight",
        "verticalAlign",
        "textWrap",
        "safeMargin",
        "truncate",
        "textInput",
      ].includes(gk)
    ) {
      global[gk] = v;
    }
  }
  return global;
}

export function regionsMatch(r1, r2) {
  if (!r1 || !r2) return false;
  return (
    Math.abs(r1.x - r2.x) < 0.001 &&
    Math.abs(r1.y - r2.y) < 0.001 &&
    Math.abs(r1.w - r2.w) < 0.001 &&
    Math.abs(r1.h - r2.h) < 0.001
  );
}

export function textOpMatchesRegion(op, region, regionId = null) {
  if (!op || op.mode !== "text") return false;
  if (regionId != null && op.batchRegionId != null) {
    return String(op.batchRegionId) === String(regionId);
  }
  return !!op.region && regionsMatch(op.region, region);
}

/** Find the text operation whose region matches a template/table region. */
export function findTextOpForRegion(operations, region, regionId = null) {
  if (!region || !Array.isArray(operations)) return { op: null, opIdx: -1 };
  const idx = operations.findIndex((o) => textOpMatchesRegion(o, region, regionId));
  return { op: idx >= 0 ? operations[idx] : null, opIdx: idx };
}
