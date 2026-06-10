/* ── Region normalization ─────────────────────────────────────────────── */

import { TEXT_STYLE_DEFAULTS } from "./text-style";

export function normalizeRegion(region, videoWidth, videoHeight) {
  if (!region) return null;
  if (!videoWidth || !videoHeight) return null;
  return {
    x: region.x / videoWidth,
    y: region.y / videoHeight,
    w: region.w / videoWidth,
    h: region.h / videoHeight,
  };
}

export function denormalizeRegion(region, videoWidth, videoHeight) {
  if (!region) return null;
  if (!videoWidth || !videoHeight) return null;
  return {
    x: region.x * videoWidth,
    y: region.y * videoHeight,
    w: region.w * videoWidth,
    h: region.h * videoHeight,
  };
}

export function isNormalizedRegion(region) {
  if (!region) return false;
  return (
    region.x >= 0 &&
    region.y >= 0 &&
    region.w >= 0 &&
    region.h >= 0 &&
    region.x <= 1 &&
    region.y <= 1 &&
    region.w <= 1 &&
    region.h <= 1 &&
    region.x + region.w <= 1 &&
    region.y + region.h <= 1
  );
}

export function ensureNormalized(region, videoWidth, videoHeight) {
  if (!region) return null;
  if (isNormalizedRegion(region)) return region;
  return normalizeRegion(region, videoWidth, videoHeight);
}

/* ── Shared types for Beru ───────────────────────────────────────────── */

let _idCounter = 0;
export function uid() {
  _idCounter = (_idCounter + 1) % 1_000_000;
  return `${Date.now().toString(36)}-${_idCounter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export const FONT_FAMILIES = [
  "Arial",
  "Arial Black",
  "Bahnschrift",
  "Calibri",
  "Cambria",
  "Candara",
  "Consolas",
  "Courier New",
  "Franklin Gothic Medium",
  "Georgia",
  "Impact",
  "Segoe UI",
  "Tahoma",
  "Times New Roman",
  "Trebuchet MS",
  "Verdana",
];

export const FONT_WEIGHTS = [
  { value: 100, label: "Thin" },
  { value: 300, label: "Light" },
  { value: 400, label: "Regular" },
  { value: 500, label: "Medium" },
  { value: 600, label: "Semi" },
  { value: 700, label: "Bold" },
  { value: 900, label: "Black" },
];

export const TEXT_ALIGNS = [
  { value: "left", label: "⇤" },
  { value: "center", label: "↔" },
  { value: "right", label: "⇥" },
];

export const DELOGO_METHODS = [
  {
    id: "temporal",
    label: "Temporal",
    description:
      "Mediana entre N fotogramas: ideal para logos estáticos sobre video en movimiento. Indistinguible.",
  },
  {
    id: "mirror",
    label: "Espejo",
    description:
      "Refleja un lado de la región sobre el otro. Perfecto para fondos uniformes (cielo, pared, suelo).",
  },
  {
    id: "mosaic",
    label: "Mosaico",
    description: "Pixelado grueso. Útil para rostros, matrículas e identificadores sensibles.",
  },
  {
    id: "inpaint",
    label: "Inpaint",
    description:
      "Interpolación 4-direcciones del filtro delogo de FFmpeg. Rápido, resultado decente.",
  },
  {
    id: "blur",
    label: "Desenfoque",
    description: "Box blur. Suaviza la región pero deja una mancha visible.",
  },
  {
    id: "fill",
    label: "Relleno",
    description: "Cubre con un color sólido. Solo para casos muy específicos.",
  },
];

export const MIRROR_SIDES = [
  { id: "right", label: "← Reflejar desde derecha" },
  { id: "left", label: "Reflejar desde izquierda →" },
  { id: "bottom", label: "↑ Reflejar desde abajo" },
  { id: "top", label: "Reflejar desde arriba ↓" },
];

export const TEXT_STYLE_PRESETS = [
  {
    id: "plain",
    name: "Sin estilo",
    previewBg: "var(--bg-elevated)",
    fontFamily: "Arial",
    fontColor: "white",
    fontWeight: 400,
    letterSpacing: 0,
    textOpacity: 1,
    bold: false,
    italic: false,
    bgEnabled: false,
    bgColor: "black",
    bgOpacity: 0,
    boxBorderWidth: 4,
    borderWidth: 0,
    borderColor: "black",
    textShadowEnabled: false,
    textShadowColor: "black",
    textShadowOffsetX: 2,
    textShadowOffsetY: 2,
  },
  {
    id: "ot-code",
    name: "Código OT",
    previewBg: "#505050",
    fontFamily: "Arial",
    fontColor: "#d7d7d7",
    fontWeight: 400,
    letterSpacing: 0,
    textOpacity: 1,
    bold: false,
    italic: false,
    bgEnabled: false,
    bgColor: "black",
    bgOpacity: 0,
    boxBorderWidth: 4,
    borderWidth: 1,
    borderColor: "#6b6b6b",
    textShadowEnabled: true,
    textShadowColor: "#2b2b2b",
    textShadowOffsetX: 1,
    textShadowOffsetY: 1,
  },
  {
    id: "caption",
    name: "Caption",
    previewBg: "#202020",
    fontFamily: "Segoe UI",
    fontColor: "white",
    fontWeight: 600,
    letterSpacing: 0,
    textOpacity: 1,
    bold: false,
    italic: false,
    bgEnabled: true,
    bgColor: "black",
    bgOpacity: 0.68,
    boxBorderWidth: 5,
    borderWidth: 0,
    borderColor: "black",
    textShadowEnabled: true,
    textShadowColor: "black",
    textShadowOffsetX: 2,
    textShadowOffsetY: 2,
  },
  {
    id: "outline-white",
    name: "Blanco stroke",
    previewBg: "#2f2f2f",
    fontFamily: "Arial",
    fontColor: "white",
    fontWeight: 600,
    letterSpacing: 0,
    textOpacity: 1,
    bold: false,
    italic: false,
    bgEnabled: false,
    bgColor: "black",
    bgOpacity: 0,
    boxBorderWidth: 4,
    borderWidth: 3,
    borderColor: "black",
    textShadowEnabled: false,
    textShadowColor: "black",
    textShadowOffsetX: 2,
    textShadowOffsetY: 2,
  },
  {
    id: "soft-shadow",
    name: "Sombra suave",
    previewBg: "#2a2a2a",
    fontFamily: "Segoe UI",
    fontColor: "white",
    fontWeight: 600,
    letterSpacing: 0,
    textOpacity: 1,
    bold: false,
    italic: false,
    bgEnabled: false,
    bgColor: "black",
    bgOpacity: 0,
    boxBorderWidth: 4,
    borderWidth: 0,
    borderColor: "black",
    textShadowEnabled: true,
    textShadowColor: "black",
    textShadowOffsetX: 3,
    textShadowOffsetY: 3,
  },
  {
    id: "deep-shadow",
    name: "Sombra fuerte",
    previewBg: "#242424",
    fontFamily: "Segoe UI",
    fontColor: "white",
    fontWeight: 700,
    letterSpacing: 0,
    textOpacity: 1,
    bold: true,
    italic: false,
    bgEnabled: false,
    bgColor: "black",
    bgOpacity: 0,
    boxBorderWidth: 4,
    borderWidth: 0,
    borderColor: "black",
    textShadowEnabled: true,
    textShadowColor: "black",
    textShadowOffsetX: 3,
    textShadowOffsetY: 3,
  },
  {
    id: "neon-yellow",
    name: "Amarillo neon",
    previewBg: "#2b2b2b",
    fontFamily: "Segoe UI",
    fontColor: "#ffff00",
    fontWeight: 700,
    letterSpacing: 0,
    textOpacity: 1,
    bold: true,
    italic: false,
    bgEnabled: false,
    bgColor: "black",
    bgOpacity: 0,
    boxBorderWidth: 4,
    borderWidth: 2,
    borderColor: "black",
    textShadowEnabled: true,
    textShadowColor: "black",
    textShadowOffsetX: 3,
    textShadowOffsetY: 3,
  },
  {
    id: "red-pop",
    name: "Rojo pop",
    previewBg: "#3a3a3a",
    fontFamily: "Segoe UI",
    fontColor: "#ff3333",
    fontWeight: 700,
    letterSpacing: 0,
    textOpacity: 1,
    bold: true,
    italic: false,
    bgEnabled: false,
    bgColor: "black",
    bgOpacity: 0,
    boxBorderWidth: 4,
    borderWidth: 2,
    borderColor: "white",
    textShadowEnabled: true,
    textShadowColor: "black",
    textShadowOffsetX: 2,
    textShadowOffsetY: 2,
  },
  {
    id: "orange-pop",
    name: "Naranja pop",
    previewBg: "#4b4b4b",
    fontFamily: "Segoe UI",
    fontColor: "#ff7a1a",
    fontWeight: 700,
    letterSpacing: 0,
    textOpacity: 1,
    bold: true,
    italic: false,
    bgEnabled: false,
    bgColor: "black",
    bgOpacity: 0,
    boxBorderWidth: 4,
    borderWidth: 2,
    borderColor: "white",
    textShadowEnabled: true,
    textShadowColor: "black",
    textShadowOffsetX: 2,
    textShadowOffsetY: 2,
  },
  {
    id: "blue-pop",
    name: "Azul pop",
    previewBg: "#606060",
    fontFamily: "Segoe UI",
    fontColor: "#168dff",
    fontWeight: 700,
    letterSpacing: 0,
    textOpacity: 1,
    bold: true,
    italic: false,
    bgEnabled: false,
    bgColor: "black",
    bgOpacity: 0,
    boxBorderWidth: 4,
    borderWidth: 2,
    borderColor: "white",
    textShadowEnabled: true,
    textShadowColor: "black",
    textShadowOffsetX: 2,
    textShadowOffsetY: 2,
  },
  {
    id: "green-pop",
    name: "Verde pop",
    previewBg: "#222222",
    fontFamily: "Segoe UI",
    fontColor: "#00e843",
    fontWeight: 700,
    letterSpacing: 0,
    textOpacity: 1,
    bold: true,
    italic: false,
    bgEnabled: false,
    bgColor: "black",
    bgOpacity: 0,
    boxBorderWidth: 4,
    borderWidth: 2,
    borderColor: "black",
    textShadowEnabled: true,
    textShadowColor: "black",
    textShadowOffsetX: 2,
    textShadowOffsetY: 2,
  },
  {
    id: "ink",
    name: "Tinta",
    previewBg: "#8c8c8c",
    fontFamily: "Arial",
    fontColor: "#111111",
    fontWeight: 600,
    letterSpacing: 0,
    textOpacity: 1,
    bold: false,
    italic: false,
    bgEnabled: false,
    bgColor: "black",
    bgOpacity: 0,
    boxBorderWidth: 4,
    borderWidth: 0,
    borderColor: "black",
    textShadowEnabled: false,
    textShadowColor: "black",
    textShadowOffsetX: 2,
    textShadowOffsetY: 2,
  },
  {
    id: "silver-block",
    name: "Plata",
    previewBg: "#9e9e9e",
    fontFamily: "Segoe UI",
    fontColor: "white",
    fontWeight: 600,
    letterSpacing: 0,
    textOpacity: 1,
    bold: false,
    italic: false,
    bgEnabled: false,
    bgColor: "black",
    bgOpacity: 0,
    boxBorderWidth: 4,
    borderWidth: 0,
    borderColor: "black",
    textShadowEnabled: true,
    textShadowColor: "#777777",
    textShadowOffsetX: 1,
    textShadowOffsetY: 1,
  },
  {
    id: "yellow-block",
    name: "Bloque amarillo",
    previewBg: "#ffe600",
    fontFamily: "Segoe UI",
    fontColor: "black",
    fontWeight: 700,
    letterSpacing: 0,
    textOpacity: 1,
    bold: true,
    italic: false,
    bgEnabled: true,
    bgColor: "#ffe600",
    bgOpacity: 1,
    boxBorderWidth: 6,
    borderWidth: 0,
    borderColor: "black",
    textShadowEnabled: false,
    textShadowColor: "black",
    textShadowOffsetX: 2,
    textShadowOffsetY: 2,
  },
  {
    id: "violet-block",
    name: "Bloque violeta",
    previewBg: "#7c3aed",
    fontFamily: "Segoe UI",
    fontColor: "white",
    fontWeight: 700,
    letterSpacing: 0,
    textOpacity: 1,
    bold: true,
    italic: false,
    bgEnabled: true,
    bgColor: "#7c3aed",
    bgOpacity: 1,
    boxBorderWidth: 6,
    borderWidth: 0,
    borderColor: "black",
    textShadowEnabled: false,
    textShadowColor: "black",
    textShadowOffsetX: 2,
    textShadowOffsetY: 2,
  },
];

export const MODE_META = {
  blur: { label: "Difuminar", color: "text-[#00f0ea]" },
  crop: { label: "Recortar", color: "text-amber-400" },
  text: { label: "Texto", color: "text-purple-400" },
  delogo: { label: "Remover", color: "text-rose-400" },
  image: { label: "Imagen", color: "text-emerald-400" },
};

/* ── Plain objects / shapes (no classes) ───────────────────────────── */

export function createRegion(x = 0, y = 0, w = 0, h = 0) {
  return { x, y, w, h };
}

export function createOperation(overrides = {}) {
  return {
    id: uid(),
    mode: "blur",
    region: null,
    blurStrength: 20,
    delogoMethod: "temporal",
    delogoFillColor: "black",
    delogoFillOpacity: 1,
    startTime: null,
    endTime: null,
    text: "",
    batchRegionId: null,
    ...TEXT_STYLE_DEFAULTS,
    imagePath: "",
    imageOpacity: 1,
    ...overrides,
  };
}

export function createQueueItem(overrides = {}) {
  return {
    path: "",
    src: "",
    filename: "",
    width: 0,
    height: 0,
    /** Resolution at first successful import probe — used for export. */
    sourceWidth: 0,
    sourceHeight: 0,
    duration: 0,
    videoCodec: "",
    pixFmt: "yuv420p",
    frameRate: 0,
    audioCodec: "",
    audioChannels: 0,
    operations: [],
    status: "idle",
    progress: 0,
    eta: null,
    speed: null,
    error: null,
    customOutputName: "",
    thumbnail: null,
    ...overrides,
  };
}

export function createPreset(overrides = {}) {
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36),
    name: "New Preset",
    fontFamily: "Arial",
    ...TEXT_STYLE_DEFAULTS,
    ...overrides,
  };
}
