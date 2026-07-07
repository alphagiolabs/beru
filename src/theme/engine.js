import {
  CSS_VAR_MAP,
  CUSTOM_THEME_PREFIX,
  DEFAULT_SLOT1_PRESET,
  DEFAULT_SLOT2_PRESET,
  THEME_TOKEN_KEYS,
} from "./tokens.js";
import { getPresetById, isPresetId } from "./presets.js";

const COLOR_RE =
  /^(#[0-9a-fA-F]{3,8}|rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(?:,\s*[\d.]+\s*)?\)|hsla?\([^)]+\))$/;

export function isCustomThemeRef(ref) {
  return typeof ref === "string" && ref.startsWith(CUSTOM_THEME_PREFIX);
}

export function customThemeId(ref) {
  if (!isCustomThemeRef(ref)) return null;
  return ref.slice(CUSTOM_THEME_PREFIX.length);
}

export function toCustomThemeRef(id) {
  return `${CUSTOM_THEME_PREFIX}${id}`;
}

function generateThemeId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `t-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * @param {string} themeRef - preset id or custom:<uuid>
 * @param {Array<{ id: string, name: string, tokens: Record<string, string> }>} customThemes
 * @returns {{ id: string, nameKey?: string, name?: string, tokens: Record<string, string>, isCustom: boolean } | null}
 */
export function resolveTheme(themeRef, customThemes = []) {
  if (!themeRef) return null;

  if (isPresetId(themeRef)) {
    const preset = getPresetById(themeRef);
    if (!preset) return null;
    return {
      id: preset.id,
      nameKey: preset.nameKey,
      tokens: { ...preset.tokens },
      isCustom: false,
    };
  }

  if (isCustomThemeRef(themeRef)) {
    const id = customThemeId(themeRef);
    const custom = customThemes.find((c) => c.id === id);
    if (!custom) return null;
    return {
      id: themeRef,
      name: custom.name,
      tokens: { ...custom.tokens },
      isCustom: true,
    };
  }

  return null;
}

export function resolveThemeName(themeRef, customThemes, t) {
  const resolved = resolveTheme(themeRef, customThemes);
  if (!resolved) return themeRef;
  if (resolved.nameKey && t) return t(resolved.nameKey);
  return resolved.name || themeRef;
}

export function validateThemeTokens(tokens) {
  if (!tokens || typeof tokens !== "object") {
    return { ok: false, error: "Invalid tokens object" };
  }
  for (const key of THEME_TOKEN_KEYS) {
    const val = tokens[key];
    if (typeof val !== "string" || !val.trim()) {
      return { ok: false, error: `Missing token: ${key}` };
    }
    if (key !== "modalShadow" && !COLOR_RE.test(val.trim())) {
      return { ok: false, error: `Invalid color for ${key}` };
    }
  }
  return { ok: true };
}

export function applyThemeTokens(tokens, activeSlot) {
  if (typeof document === "undefined" || !tokens) return;

  const root = document.documentElement;
  for (const key of THEME_TOKEN_KEYS) {
    const cssVar = CSS_VAR_MAP[key];
    const val = tokens[key];
    if (cssVar && val != null) {
      root.style.setProperty(cssVar, val);
    }
  }

  if (activeSlot === 1 || activeSlot === 2) {
    root.setAttribute("data-theme-slot", String(activeSlot));
  }

  // Legacy hint for any remaining CSS selectors
  const isLightish = parseLuminance(tokens.bgApp) > 0.45 || parseLuminance(tokens.bgSurface) > 0.5;
  if (isLightish) {
    root.setAttribute("data-theme", "light");
  } else {
    root.removeAttribute("data-theme");
  }
}

export function deriveWindowChrome(tokens) {
  return {
    background: tokens?.bgApp || "#0a0a0a",
    symbols: tokens?.textPrimary || "#ffffff",
  };
}

export function slotToLegacyTheme(slot) {
  return slot === 1 ? "light" : "dark";
}

function legacyThemeToSlot(theme) {
  return theme === "light" ? 1 : 2;
}

/**
 * @param {object} settings
 * @returns {{ themeActiveSlot: 1|2, themeSlot1: string, themeSlot2: string, customThemes: object[], activeThemeRef: string, theme: string }}
 */
export function migrateThemeSettings(settings = {}) {
  let themeSlot1 = settings.themeSlot1;
  let themeSlot2 = settings.themeSlot2;
  let themeActiveSlot = settings.themeActiveSlot;
  const customThemes = Array.isArray(settings.customThemes) ? settings.customThemes : [];

  const hasNewSchema = themeSlot1 && themeSlot2;

  if (!hasNewSchema) {
    themeSlot1 = DEFAULT_SLOT1_PRESET;
    themeSlot2 = DEFAULT_SLOT2_PRESET;
    themeActiveSlot = legacyThemeToSlot(settings.theme === "light" ? "light" : "dark");
  } else {
    if (themeActiveSlot !== 1 && themeActiveSlot !== 2) {
      themeActiveSlot = legacyThemeToSlot(settings.theme === "light" ? "light" : "dark");
    }
    if (!isValidThemeRef(themeSlot1, customThemes)) themeSlot1 = DEFAULT_SLOT1_PRESET;
    if (!isValidThemeRef(themeSlot2, customThemes)) themeSlot2 = DEFAULT_SLOT2_PRESET;
  }

  const activeThemeRef = themeActiveSlot === 1 ? themeSlot1 : themeSlot2;
  const theme = slotToLegacyTheme(themeActiveSlot);

  return {
    themeActiveSlot,
    themeSlot1,
    themeSlot2,
    customThemes: sanitizeCustomThemes(customThemes),
    activeThemeRef,
    theme,
    needsMigrationSave: !hasNewSchema,
  };
}

export function isValidThemeRef(ref, customThemes = []) {
  if (isPresetId(ref)) return true;
  if (isCustomThemeRef(ref)) {
    const id = customThemeId(ref);
    return customThemes.some((c) => c.id === id);
  }
  return false;
}

export function sanitizeCustomThemes(themes) {
  if (!Array.isArray(themes)) return [];
  return themes
    .filter((t) => t && typeof t.id === "string" && typeof t.name === "string")
    .map((t) => ({
      id: t.id,
      name: t.name,
      tokens: normalizeTokens(t.tokens),
      createdAt: t.createdAt || new Date().toISOString(),
      updatedAt: t.updatedAt || t.createdAt || new Date().toISOString(),
    }))
    .filter((t) => validateThemeTokens(t.tokens).ok);
}

function normalizeTokens(tokens) {
  const base = getPresetById(DEFAULT_SLOT2_PRESET)?.tokens || {};
  const out = { ...base };
  if (tokens && typeof tokens === "object") {
    for (const key of THEME_TOKEN_KEYS) {
      if (typeof tokens[key] === "string") out[key] = tokens[key];
    }
  }
  return out;
}

/**
 * @param {string} name
 * @param {string} [basePresetId]
 */
export function createCustomTheme(name, basePresetId = DEFAULT_SLOT2_PRESET) {
  const base = getPresetById(basePresetId) || getPresetById(DEFAULT_SLOT2_PRESET);
  const now = new Date().toISOString();
  const id = generateThemeId();
  return {
    id,
    name: name || "Custom theme",
    tokens: { ...(base?.tokens || {}) },
    createdAt: now,
    updatedAt: now,
  };
}

export function duplicateCustomTheme(source, customThemes = []) {
  const resolved = resolveTheme(source, customThemes);
  if (!resolved) return null;
  const now = new Date().toISOString();
  const id = generateThemeId();
  const baseName = resolved.name || resolved.nameKey || "Theme";
  return {
    id,
    name: `${baseName} (copy)`,
    tokens: { ...resolved.tokens },
    createdAt: now,
    updatedAt: now,
  };
}

function parseLuminance(hex) {
  if (!hex || typeof hex !== "string") return 0;
  const m = hex.match(/^#([0-9a-fA-F]{6})$/);
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
