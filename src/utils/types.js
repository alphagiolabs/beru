// @ts-check
import { DEFAULT_PIX_FMT } from "../../shared/job-manifest.js";

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
    x: Math.round(region.x * videoWidth),
    y: Math.round(region.y * videoHeight),
    w: Math.round(region.w * videoWidth),
    h: Math.round(region.h * videoHeight),
  };
}

const NORM_EPS = 1e-6;

export function isNormalizedRegion(region) {
  if (!region) return false;
  return (
    region.x >= -NORM_EPS &&
    region.y >= -NORM_EPS &&
    region.w >= 0 &&
    region.h >= 0 &&
    region.x <= 1 + NORM_EPS &&
    region.y <= 1 + NORM_EPS &&
    region.w <= 1 + NORM_EPS &&
    region.h <= 1 + NORM_EPS &&
    region.x + region.w <= 1 + NORM_EPS &&
    region.y + region.h <= 1 + NORM_EPS
  );
}

function clampUnitRegion(region) {
  return {
    x: Math.min(1, Math.max(0, region.x)),
    y: Math.min(1, Math.max(0, region.y)),
    w: Math.min(1, Math.max(0, region.w)),
    h: Math.min(1, Math.max(0, region.h)),
  };
}

export function ensureNormalized(region, videoWidth, videoHeight) {
  if (!region) return null;
  if (isNormalizedRegion(region)) {
    const clean =
      region.x >= 0 && region.y >= 0 && region.x + region.w <= 1 && region.y + region.h <= 1;
    return clean ? region : clampUnitRegion(region);
  }
  const maybeNorm =
    region.x >= 0 &&
    region.y >= 0 &&
    region.w >= 0 &&
    region.h >= 0 &&
    region.x <= 1 &&
    region.y <= 1 &&
    region.w <= 1 &&
    region.h <= 1;
  if (maybeNorm) return region;
  return normalizeRegion(region, videoWidth, videoHeight);
}

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
  { value: 100, labelKey: "catalog.fontWeight.100" },
  { value: 300, labelKey: "catalog.fontWeight.300" },
  { value: 400, labelKey: "catalog.fontWeight.400" },
  { value: 500, labelKey: "catalog.fontWeight.500" },
  { value: 600, labelKey: "catalog.fontWeight.600" },
  { value: 700, labelKey: "catalog.fontWeight.700" },
  { value: 900, labelKey: "catalog.fontWeight.900" },
];

export const TEXT_ALIGNS = [
  { value: "left", label: "⇤" },
  { value: "center", label: "↔" },
  { value: "right", label: "⇥" },
];

export const DELOGO_METHODS = [
  {
    id: "blur",
    labelKey: "catalog.delogoMethod.blur",
    descriptionKey: "catalog.delogoMethod.blur.desc",
  },
  {
    id: "temporal",
    labelKey: "catalog.delogoMethod.temporal",
    descriptionKey: "catalog.delogoMethod.temporal.desc",
  },
  {
    id: "mirror",
    labelKey: "catalog.delogoMethod.mirror",
    descriptionKey: "catalog.delogoMethod.mirror.desc",
  },
  {
    id: "mosaic",
    labelKey: "catalog.delogoMethod.mosaic",
    descriptionKey: "catalog.delogoMethod.mosaic.desc",
  },
  {
    id: "inpaint",
    labelKey: "catalog.delogoMethod.inpaint",
    descriptionKey: "catalog.delogoMethod.inpaint.desc",
  },
  {
    id: "fill",
    labelKey: "catalog.delogoMethod.fill",
    descriptionKey: "catalog.delogoMethod.fill.desc",
  },
  {
    id: "cover",
    labelKey: "catalog.delogoMethod.cover",
    descriptionKey: "catalog.delogoMethod.cover.desc",
  },
];

export const MIRROR_SIDES = [
  { id: "right", labelKey: "catalog.mirrorSide.right" },
  { id: "left", labelKey: "catalog.mirrorSide.left" },
  { id: "bottom", labelKey: "catalog.mirrorSide.bottom" },
  { id: "top", labelKey: "catalog.mirrorSide.top" },
];

export const PET_MOVEMENT_MODES = [
  { id: "fixed", labelKey: "settings.petdex.moveFixed" },
  { id: "walk", labelKey: "settings.petdex.moveWalk" },
];

// Legacy persisted values used Spanish words ("fijo"/"caminar"); normalize at the boundary.
export function normalizePetMovement(value) {
  return value === "walk" || value === "caminar" ? "walk" : "fixed";
}

export const ID_COLUMN_ALIASES = [
  "id",
  "code",
  "codigo",
  "video",
  "archivo",
  "filename",
  "name",
  "nombre",
  "identificador",
];

const TEXT_PRESET_BASE = Object.freeze({
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
});

function mkTextPreset(id, previewBg, overrides = {}) {
  return { id, nameKey: `catalog.preset.${id}`, previewBg, ...TEXT_PRESET_BASE, ...overrides };
}

export const TEXT_STYLE_PRESETS = [
  mkTextPreset("plain", "var(--bg-elevated)"),
  mkTextPreset("ot-code", "#505050", {
    fontColor: "#d7d7d7",
    borderWidth: 1,
    borderColor: "#6b6b6b",
    textShadowEnabled: true,
    textShadowColor: "#2b2b2b",
    textShadowOffsetX: 1,
    textShadowOffsetY: 1,
  }),
  mkTextPreset("soft-gray", "#5b5960", {
    fontColor: "#d2d0d4",
    fontWeight: 300,
    letterSpacing: 1,
    textOpacity: 0.92,
    textShadowEnabled: true,
    textShadowColor: "#4b4850",
    textShadowOffsetX: 1,
    textShadowOffsetY: 1,
  }),
  mkTextPreset("caption", "#202020", {
    fontFamily: "Segoe UI",
    fontWeight: 600,
    bgEnabled: true,
    bgOpacity: 0.68,
    boxBorderWidth: 5,
    textShadowEnabled: true,
  }),
  mkTextPreset("outline-white", "#2f2f2f", {
    fontWeight: 600,
    borderWidth: 3,
  }),
  mkTextPreset("soft-shadow", "#2a2a2a", {
    fontFamily: "Segoe UI",
    fontWeight: 600,
    textShadowEnabled: true,
    textShadowOffsetX: 3,
    textShadowOffsetY: 3,
  }),
  mkTextPreset("deep-shadow", "#242424", {
    fontFamily: "Segoe UI",
    fontWeight: 700,
    bold: true,
    textShadowEnabled: true,
    textShadowOffsetX: 3,
    textShadowOffsetY: 3,
  }),
  mkTextPreset("neon-yellow", "#2b2b2b", {
    fontFamily: "Segoe UI",
    fontColor: "#ffff00",
    fontWeight: 700,
    bold: true,
    borderWidth: 2,
    textShadowEnabled: true,
    textShadowOffsetX: 3,
    textShadowOffsetY: 3,
  }),
  mkTextPreset("red-pop", "#3a3a3a", {
    fontFamily: "Segoe UI",
    fontColor: "#ff3333",
    fontWeight: 700,
    bold: true,
    borderWidth: 2,
    borderColor: "white",
    textShadowEnabled: true,
  }),
  mkTextPreset("orange-pop", "#4b4b4b", {
    fontFamily: "Segoe UI",
    fontColor: "#ff7a1a",
    fontWeight: 700,
    bold: true,
    borderWidth: 2,
    borderColor: "white",
    textShadowEnabled: true,
  }),
  mkTextPreset("blue-pop", "#606060", {
    fontFamily: "Segoe UI",
    fontColor: "#168dff",
    fontWeight: 700,
    bold: true,
    borderWidth: 2,
    borderColor: "white",
    textShadowEnabled: true,
  }),
  mkTextPreset("green-pop", "#222222", {
    fontFamily: "Segoe UI",
    fontColor: "#00e843",
    fontWeight: 700,
    bold: true,
    borderWidth: 2,
    textShadowEnabled: true,
  }),
  mkTextPreset("ink", "#8c8c8c", {
    fontColor: "#111111",
    fontWeight: 600,
  }),
  mkTextPreset("silver-block", "#9e9e9e", {
    fontFamily: "Segoe UI",
    fontWeight: 600,
    textShadowEnabled: true,
    textShadowColor: "#777777",
    textShadowOffsetX: 1,
    textShadowOffsetY: 1,
  }),
  mkTextPreset("yellow-block", "#ffe600", {
    fontFamily: "Segoe UI",
    fontColor: "black",
    fontWeight: 700,
    bold: true,
    bgEnabled: true,
    bgColor: "#ffe600",
    bgOpacity: 1,
    boxBorderWidth: 6,
  }),
  mkTextPreset("violet-block", "#7c3aed", {
    fontFamily: "Segoe UI",
    fontWeight: 700,
    bold: true,
    bgEnabled: true,
    bgColor: "#7c3aed",
    bgOpacity: 1,
    boxBorderWidth: 6,
  }),
  mkTextPreset("cinema", "#1c1c1e", {
    fontFamily: "Segoe UI",
    fontColor: "#f5f5f7",
    fontWeight: 500,
    letterSpacing: 0.5,
    textShadowEnabled: true,
    textShadowColor: "rgba(0,0,0,0.85)",
    textShadowOffsetX: 1,
  }),
  mkTextPreset("lower-third", "#0a0a0c", {
    fontFamily: "Segoe UI",
    fontColor: "#ffffff",
    fontWeight: 600,
    letterSpacing: 0.2,
    bgEnabled: true,
    bgColor: "#000000",
    bgOpacity: 0.55,
    boxBorderWidth: 8,
    textShadowOffsetX: 0,
    textShadowOffsetY: 0,
  }),
  mkTextPreset("thin-ghost", "#2c2c2e", {
    fontFamily: "Segoe UI",
    fontColor: "#ffffff",
    fontWeight: 300,
    letterSpacing: 1.2,
    textOpacity: 0.78,
    textShadowOffsetX: 0,
    textShadowOffsetY: 0,
  }),
  mkTextPreset("gold", "#2a2418", {
    fontFamily: "Georgia",
    fontColor: "#f0d48a",
    fontWeight: 600,
    letterSpacing: 0.4,
    textShadowEnabled: true,
    textShadowColor: "#3a2e12",
    textShadowOffsetX: 1,
    textShadowOffsetY: 1,
  }),
  mkTextPreset("cyan", "#0f1c22", {
    fontFamily: "Segoe UI",
    fontColor: "#64d2ff",
    fontWeight: 600,
    textShadowEnabled: true,
    textShadowColor: "#063246",
    textShadowOffsetX: 1,
    textShadowOffsetY: 1,
  }),
  mkTextPreset("magenta", "#24141f", {
    fontFamily: "Segoe UI",
    fontColor: "#ff6bcb",
    fontWeight: 700,
    bold: true,
    textShadowEnabled: true,
    textShadowColor: "#4a1038",
    textShadowOffsetX: 1,
    textShadowOffsetY: 1,
  }),
  mkTextPreset("outline-dark", "#e5e5ea", {
    fontColor: "#1c1c1e",
    fontWeight: 700,
    bold: true,
    borderWidth: 2,
    borderColor: "#ffffff",
    textShadowOffsetX: 0,
    textShadowOffsetY: 0,
  }),
  mkTextPreset("italic-soft", "#3a3a3c", {
    fontFamily: "Georgia",
    fontColor: "#e5e5ea",
    letterSpacing: 0.3,
    textOpacity: 0.95,
    italic: true,
    textShadowEnabled: true,
    textShadowColor: "#1c1c1e",
    textShadowOffsetX: 1,
    textShadowOffsetY: 1,
  }),
  mkTextPreset("mono-tag", "#1e1e20", {
    fontFamily: "Consolas",
    fontColor: "#d1d1d6",
    fontWeight: 500,
    letterSpacing: 0.6,
    bgEnabled: true,
    bgColor: "#2c2c2e",
    bgOpacity: 0.92,
    boxBorderWidth: 5,
    textShadowOffsetX: 0,
    textShadowOffsetY: 0,
  }),
  mkTextPreset("rose-block", "#ff375f", {
    fontFamily: "Segoe UI",
    fontColor: "#ffffff",
    fontWeight: 700,
    bold: true,
    bgEnabled: true,
    bgColor: "#ff375f",
    bgOpacity: 1,
    boxBorderWidth: 6,
    textShadowOffsetX: 0,
    textShadowOffsetY: 0,
  }),
  mkTextPreset("teal-block", "#30b0c7", {
    fontFamily: "Segoe UI",
    fontColor: "#ffffff",
    fontWeight: 700,
    bold: true,
    bgEnabled: true,
    bgColor: "#30b0c7",
    bgOpacity: 1,
    boxBorderWidth: 6,
    textShadowOffsetX: 0,
    textShadowOffsetY: 0,
  }),
  mkTextPreset("alert-bar", "#ff3b30", {
    fontFamily: "Segoe UI",
    fontColor: "#ffffff",
    fontWeight: 700,
    bold: true,
    letterSpacing: 0.4,
    bgEnabled: true,
    bgColor: "#ff3b30",
    bgOpacity: 0.95,
    boxBorderWidth: 7,
    textShadowOffsetX: 0,
    textShadowOffsetY: 0,
  }),
  mkTextPreset("snow", "#3a3a3c", {
    fontColor: "#ffffff",
    fontWeight: 600,
    borderWidth: 2,
    borderColor: "#1c1c1e",
    textShadowEnabled: true,
    textShadowColor: "rgba(0,0,0,0.55)",
    textShadowOffsetX: 0,
    textShadowOffsetY: 1,
  }),
  mkTextPreset("mint", "#163028", {
    fontFamily: "Segoe UI",
    fontColor: "#63e6be",
    fontWeight: 600,
    textShadowEnabled: true,
    textShadowColor: "#0b1f19",
    textShadowOffsetX: 1,
    textShadowOffsetY: 1,
  }),
  mkTextPreset("amber-block", "#ff9f0a", {
    fontFamily: "Segoe UI",
    fontColor: "#1c1c1e",
    fontWeight: 700,
    bold: true,
    bgEnabled: true,
    bgColor: "#ff9f0a",
    bgOpacity: 1,
    boxBorderWidth: 6,
    textShadowOffsetX: 0,
    textShadowOffsetY: 0,
  }),
  mkTextPreset("glass", "#1a1a1c", {
    fontFamily: "Segoe UI",
    fontColor: "#f2f2f7",
    fontWeight: 500,
    letterSpacing: 0.2,
    bgEnabled: true,
    bgColor: "#3a3a3c",
    bgOpacity: 0.42,
    boxBorderWidth: 7,
    textShadowOffsetX: 0,
    textShadowOffsetY: 0,
  }),
];

export function createQueueItem(overrides = {}) {
  return {
    path: "",
    src: "",
    filename: "",
    width: 0,
    height: 0,
    sourceWidth: 0,
    sourceHeight: 0,
    duration: 0,
    trimStart: null,
    trimEnd: null,
    videoCodec: "",
    pixFmt: DEFAULT_PIX_FMT,
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
