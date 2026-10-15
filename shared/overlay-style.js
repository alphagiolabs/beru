export const OVERLAY_TEXT_MAX_LENGTH = 500;
export const OVERLAY_SIZE_MIN = 0.01;
export const OVERLAY_SIZE_MAX = 0.5;
export const OVERLAY_MAX_COUNT = 50;
export const OVERLAY_OUTLINE_MAX = 0.25;
export const TEXT_FONT_FAMILIES = Object.freeze(["Arial", "Segoe UI"]);
export const TEXT_ALIGNS = Object.freeze(["left", "center", "right"]);

export const DEFAULT_OVERLAY_STYLE = Object.freeze({
  color: "#ffffff",
  size: 0.06,
  fontFamily: "Arial",
  bold: false,
  italic: false,
  textAlign: "center",
  textOpacity: 1,
  borderWidth: 0.0625,
  borderColor: "#000000",
  textShadowEnabled: false,
  textShadowColor: "#000000",
  bgEnabled: false,
  bgColor: "#000000",
  bgOpacity: 0.65,
});

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export function normalizeOverlayStyle(style) {
  return { ...DEFAULT_OVERLAY_STYLE, ...(style ?? {}) };
}

const isUnit = (value, max = 1) => typeof value === "number" && value >= 0 && value <= max;

export function validateOverlayGeometry(geometry) {
  const g = geometry;
  if (!g || typeof g !== "object") return "geometría fuera del lienzo";
  if (!isUnit(g.x) || !isUnit(g.y)) return "geometría fuera del lienzo";
  if (!(typeof g.w === "number" && g.w > 0) || !(typeof g.h === "number" && g.h > 0)) {
    return "geometría fuera del lienzo";
  }
  if (g.x + g.w > 1 + 1e-9 || g.y + g.h > 1 + 1e-9) return "geometría fuera del lienzo";
  return null;
}

export function validateOverlayText(text) {
  if (typeof text !== "string" || text.trim().length === 0) return "El texto del título está vacío";
  if (text.length > OVERLAY_TEXT_MAX_LENGTH) {
    return `El texto supera ${OVERLAY_TEXT_MAX_LENGTH} caracteres`;
  }
  return null;
}

export function validateOverlayStyle(style) {
  if (!style || typeof style !== "object") return "El estilo del título es inválido";
  const s = normalizeOverlayStyle(style);
  const colors = [s.color, s.borderColor, s.textShadowColor, s.bgColor];
  if (!colors.every((color) => typeof color === "string" && HEX_COLOR.test(color))) {
    return "El color del título debe ser #rrggbb";
  }
  if (!(typeof s.size === "number" && s.size >= OVERLAY_SIZE_MIN && s.size <= OVERLAY_SIZE_MAX)) {
    return "El tamaño del título está fuera de rango";
  }
  if (!TEXT_FONT_FAMILIES.includes(s.fontFamily)) return "La fuente del título no está disponible";
  if (typeof s.bold !== "boolean" || typeof s.italic !== "boolean") {
    return "La negrita y la cursiva deben ser booleanos";
  }
  if (!TEXT_ALIGNS.includes(s.textAlign)) return "La alineación del título es inválida";
  if (!isUnit(s.textOpacity)) return "La opacidad del título está fuera de rango";
  if (!isUnit(s.borderWidth, OVERLAY_OUTLINE_MAX))
    return "El contorno del título está fuera de rango";
  if (typeof s.textShadowEnabled !== "boolean" || typeof s.bgEnabled !== "boolean") {
    return "La sombra y el fondo deben ser booleanos";
  }
  if (!isUnit(s.bgOpacity)) return "La opacidad del fondo está fuera de rango";
  return null;
}
