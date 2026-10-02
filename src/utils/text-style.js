import { clampNum } from "./clamp";

export const LETTER_SPACING_MIN = -20;
export const LETTER_SPACING_MAX = 80;

export function letterSpacingToPx(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(LETTER_SPACING_MAX, Math.max(LETTER_SPACING_MIN, n));
}

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

const GLOBAL_TEXT_STYLE_KEYS = new Set([
  "textInput",
  ...TEXT_STYLE_KEYS.map((k) => GLOBAL_KEY_MAP[k] || k),
]);

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
  ...Object.fromEntries(
    Object.entries(TEXT_STYLE_DEFAULTS).map(([key, value]) => [GLOBAL_KEY_MAP[key] || key, value]),
  ),
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

export function hydrateGlobalTextStyle(textStyle = {}) {
  const picked = pickTextStyle(textStyle);
  for (const [opKey, globalKey] of Object.entries(GLOBAL_KEY_MAP)) {
    if (picked[opKey] === undefined && textStyle[globalKey] !== undefined) {
      picked[opKey] = textStyle[globalKey];
    }
  }
  return patchToGlobalState(normalizeTextStyle(picked));
}

export function persistGlobalTextStyle(s) {
  return {
    textInput: s.textInput,
    ...patchToGlobalState(getGlobalTextStyleFromState(s)),
  };
}

export function pickGlobalTextStyle(s) {
  const out = {};
  for (const k of TEXT_STYLE_KEYS) {
    const gk = GLOBAL_KEY_MAP[k] || k;
    out[gk] = s[gk];
  }
  return out;
}

export function getGlobalTextStyleFromState(s) {
  const raw = {};
  for (const k of TEXT_STYLE_KEYS) {
    raw[k] = s[GLOBAL_KEY_MAP[k] || k];
  }
  return normalizeTextStyle(raw);
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

export function patchToGlobalState(patch) {
  const global = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    const gk = GLOBAL_KEY_MAP[k] || k;
    if (GLOBAL_TEXT_STYLE_KEYS.has(gk)) global[gk] = v;
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

export function findTextOpForRegion(operations, region, regionId = null) {
  if (!region || !Array.isArray(operations)) return { op: null, opIdx: -1 };
  const linkedIdx =
    regionId == null
      ? -1
      : operations.findIndex(
          (op) =>
            op.mode === "text" &&
            op.batchRegionId != null &&
            String(op.batchRegionId) === String(regionId),
        );
  const idx =
    linkedIdx >= 0
      ? linkedIdx
      : operations.findIndex((o) => textOpMatchesRegion(o, region, regionId));
  return { op: idx >= 0 ? operations[idx] : null, opIdx: idx };
}
