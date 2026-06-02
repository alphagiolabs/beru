const NAMED_COLORS = {
  white: "#ffffff", black: "#000000", red: "#ff0000", green: "#008000",
  blue: "#0000ff", yellow: "#ffff00", cyan: "#00ffff", magenta: "#ff00ff",
  gray: "#808080", grey: "#808080", silver: "#c0c0c0", maroon: "#800000",
  olive: "#808000", purple: "#800080", teal: "#008080", navy: "#000080",
  orange: "#ffa500", pink: "#ffc0cb", brown: "#a52a2a", lime: "#00ff00",
  aqua: "#00ffff", fuchsia: "#ff00ff",
};

export function normalizeColor(c) {
  if (!c) return null;
  const t = String(c).trim().toLowerCase();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/.test(t)) {
    if (t.length === 4) {
      return "#" + t[1] + t[1] + t[2] + t[2] + t[3] + t[3];
    }
    return t;
  }
  return NAMED_COLORS[t] || null;
}