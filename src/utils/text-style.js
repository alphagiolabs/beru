/** Shared text style shape for preview overlays and batch template regions. */

export const TEXT_STYLE_KEYS = [
  "fontSize", "fontColor", "fontFamily", "fontWeight", "letterSpacing",
  "textAlign", "textOpacity", "bold", "italic", "bgEnabled", "bgColor",
  "bgOpacity", "boxBorderWidth", "borderWidth", "borderColor",
];

const GLOBAL_KEY_MAP = {
  fontSize: "textFontSize",
  fontColor: "textFontColor",
};

export function pickTextStyle(obj) {
  if (!obj) return {};
  const out = {};
  for (const k of TEXT_STYLE_KEYS) {
    if (obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
}

export function getGlobalTextStyleFromState(s) {
  return {
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
  };
}

export function mergeTextStyles(...layers) {
  return layers.reduce((acc, layer) => ({ ...acc, ...pickTextStyle(layer) }), {});
}

/** Map operation-style patch keys to global store field names. */
export function patchToGlobalState(patch) {
  const global = {};
  for (const [k, v] of Object.entries(patch)) {
    const gk = GLOBAL_KEY_MAP[k] || k;
    if (["textFontSize", "textFontColor", "fontFamily", "fontWeight", "letterSpacing",
      "textAlign", "textOpacity", "bold", "italic", "bgEnabled", "bgColor", "bgOpacity",
      "boxBorderWidth", "borderWidth", "borderColor", "textInput"].includes(gk)) {
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