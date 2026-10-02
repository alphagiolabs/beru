import { normalizeColor } from "../utils/color-utils.js";

function channels(color) {
  const value = typeof color === "string" ? color.trim() : "";
  const opaqueHex = value.match(/^#(?:([\da-f]{3})f|([\da-f]{6})ff)$/i);
  const hex = normalizeColor(opaqueHex ? `#${opaqueHex[1] || opaqueHex[2]}` : value);
  if (hex)
    return hex
      .slice(1)
      .match(/../g)
      .map((value) => parseInt(value, 16));
  const rgb = value.match(
    /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*(1(?:\.0+)?)\s*)?\)$/i,
  );
  if (rgb) return rgb.slice(1, 4).map(Number);
  const hsl = value.match(
    /^hsla?\(\s*([+-]?[\d.]+)(?:deg)?\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*(?:,\s*(1(?:\.0+)?)\s*)?\)$/i,
  );
  if (!hsl) return null;
  const hue = ((Number(hsl[1]) % 360) + 360) % 360;
  const saturation = Number(hsl[2]) / 100;
  const lightness = Number(hsl[3]) / 100;
  const amplitude = saturation * Math.min(lightness, 1 - lightness);
  return [0, 8, 4].map((offset) => {
    const sector = (offset + hue / 30) % 12;
    return Math.round(
      255 * (lightness - amplitude * Math.max(-1, Math.min(sector - 3, 9 - sector, 1))),
    );
  });
}

function luminance(rgb) {
  return rgb.reduce((sum, channel, index) => {
    const value = channel / 255;
    const linear = value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    return sum + linear * [0.2126, 0.7152, 0.0722][index];
  }, 0);
}

function contrast(a, b) {
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function mix(a, b, amount) {
  return a.map((value, index) => Math.round(value * (1 - amount) + b[index] * amount));
}

function readableColor(color, backgrounds) {
  const rgb = channels(color);
  if (!rgb || backgrounds.some((background) => !background)) return color;
  const minimum = (candidate) => Math.min(...backgrounds.map((bg) => contrast(candidate, bg)));
  if (minimum(rgb) >= 4.5) return color;
  const black = [0, 0, 0];
  const white = [255, 255, 255];
  const target = minimum(black) > minimum(white) ? black : white;
  for (let step = 1; step <= 100; step++) {
    const candidate = mix(rgb, target, step / 100);
    if (minimum(candidate) >= 4.5 || step === 100) {
      return `#${candidate.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
    }
  }
}

export function getThemeTextColors(tokens) {
  const surfaces = [tokens.bgApp, tokens.bgSurface, tokens.bgElevated].map(channels);
  const primary = channels(tokens.textPrimary);
  const brand = channels(tokens.accentBrand);
  const rose = channels(tokens.rose);
  const backgrounds = surfaces.flatMap((surface) =>
    surface && primary && brand && rose
      ? [surface, mix(surface, primary, 0.08), mix(surface, brand, 0.22), mix(surface, rose, 0.2)]
      : [surface],
  );
  return {
    textPrimary: readableColor(tokens.textPrimary, backgrounds),
    textSecondary: readableColor(tokens.textSecondary, backgrounds),
    textDim: readableColor(tokens.textDim, backgrounds),
    accent: readableColor(tokens.accent, backgrounds),
    brand: readableColor(tokens.accentBrand, backgrounds),
    amber: readableColor(tokens.amber, backgrounds),
    rose: readableColor(tokens.rose, backgrounds),
    purple: readableColor(tokens.purple, backgrounds),
    onBrand: readableColor(tokens.bgApp, [brand]),
    onRose: readableColor("#ffffff", [rose]),
  };
}
