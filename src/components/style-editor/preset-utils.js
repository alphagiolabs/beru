import { pickTextStyle } from "../../utils/text-style";

export function samePresetValue(a, b) {
  if (typeof a === "string" || typeof b === "string") {
    return String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase();
  }
  return a === b;
}

export function presetMatches(preset, currentStyle) {
  const style = pickTextStyle(preset);
  return Object.entries(style).every(([key, value]) => samePresetValue(currentStyle[key], value));
}

function presetTextShadow(preset) {
  if (!preset.textShadowEnabled) return "none";
  const x = Math.max(-4, Math.min(4, Number(preset.textShadowOffsetX ?? 2)));
  const y = Math.max(-4, Math.min(4, Number(preset.textShadowOffsetY ?? 2)));
  return `${x}px ${y}px 0 ${preset.textShadowColor || "black"}`;
}

export function presetPreviewTextStyle(preset) {
  const strokeWidth = Math.min(2, Number(preset.borderWidth ?? 0));
  return {
    color: preset.fontColor || "white",
    fontFamily: `"${preset.fontFamily || "Arial"}", sans-serif`,
    fontSize: "18px",
    fontStyle: preset.italic ? "italic" : "normal",
    fontWeight: preset.fontWeight ?? (preset.bold ? 700 : 400),
    letterSpacing: `${Math.min(1.5, Number(preset.letterSpacing ?? 0))}px`,
    lineHeight: 1,
    padding: preset.bgEnabled ? "2px 3px" : 0,
    borderRadius: "3px",
    background: preset.bgEnabled ? preset.bgColor : "transparent",
    textShadow: presetTextShadow(preset),
    WebkitTextStroke: strokeWidth > 0 ? `${strokeWidth}px ${preset.borderColor || "black"}` : "0",
  };
}
