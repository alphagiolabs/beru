import { swallow } from "../../utils/swallow.js";
import {
  applyThemeTokens,
  createCustomTheme,
  deriveWindowChrome,
  duplicateCustomTheme,
  resolveTheme,
  slotToLegacyTheme,
  toCustomThemeRef,
  validateThemeTokens,
} from "../../theme/engine.js";
import { DEFAULT_SLOT1_PRESET, DEFAULT_SLOT2_PRESET } from "../../theme/tokens.js";
import { getPresetById } from "../../theme/presets.js";

async function syncWindowChrome(tokens) {
  const api = window.api;
  if (!api?.setWindowTheme) return;
  try {
    await api.setWindowTheme(deriveWindowChrome(tokens));
  } catch (e) {
    swallow("setWindowTheme", e);
  }
}

export async function persistThemeSettings(partial) {
  const api = window.api;
  if (!api?.saveSettings) return;
  try {
    await api.saveSettings(partial);
  } catch (e) {
    swallow("saveSettings(theme)", e);
  }
}

export function createThemeSlice(set, get) {
  return {
    themeActiveSlot: 2,
    themeSlot1: DEFAULT_SLOT1_PRESET,
    themeSlot2: DEFAULT_SLOT2_PRESET,
    customThemes: [],

    applyActiveTheme: async () => {
      const { themeActiveSlot, themeSlot1, themeSlot2, customThemes } = get();
      const ref = themeActiveSlot === 1 ? themeSlot1 : themeSlot2;
      const resolved = resolveTheme(ref, customThemes);
      const fallback =
        themeActiveSlot === 1
          ? getPresetById(DEFAULT_SLOT1_PRESET)
          : getPresetById(DEFAULT_SLOT2_PRESET);
      const tokens = resolved?.tokens || fallback?.tokens;
      if (!tokens) return;

      applyThemeTokens(tokens, themeActiveSlot);
      await syncWindowChrome(tokens);
    },

    setThemeActiveSlot: async (slot) => {
      const next = slot === 1 ? 1 : 2;
      set({ themeActiveSlot: next });
      await get().applyActiveTheme();
      await persistThemeSettings({
        themeActiveSlot: next,
        theme: slotToLegacyTheme(next),
      });
    },

    toggleTheme: () => {
      const { themeActiveSlot } = get();
      return get().setThemeActiveSlot(themeActiveSlot === 1 ? 2 : 1);
    },

    assignThemeToSlot: async (slot, themeRef) => {
      const key = slot === 1 ? "themeSlot1" : "themeSlot2";
      const fallback = slot === 1 ? DEFAULT_SLOT1_PRESET : DEFAULT_SLOT2_PRESET;
      const { customThemes } = get();
      const resolved = resolveTheme(themeRef, customThemes);
      const ref = resolved ? themeRef : fallback;

      set({ [key]: ref });
      const { themeActiveSlot } = get();
      if ((slot === 1 && themeActiveSlot === 1) || (slot === 2 && themeActiveSlot === 2)) {
        await get().applyActiveTheme();
      }
      await persistThemeSettings({ [key]: ref });
    },

    saveCustomTheme: async (theme) => {
      const validation = validateThemeTokens(theme?.tokens);
      if (!validation.ok) return { ok: false, error: validation.error };

      const now = new Date().toISOString();
      const entry = {
        id: theme.id || createCustomTheme(theme.name).id,
        name: theme.name?.trim() || "Custom theme",
        tokens: { ...theme.tokens },
        createdAt: theme.createdAt || now,
        updatedAt: now,
      };

      const { customThemes } = get();
      const idx = customThemes.findIndex((c) => c.id === entry.id);
      const nextThemes =
        idx >= 0 ? customThemes.map((c, i) => (i === idx ? entry : c)) : [...customThemes, entry];

      set({ customThemes: nextThemes });
      await persistThemeSettings({ customThemes: nextThemes });

      const ref = toCustomThemeRef(entry.id);
      const { themeSlot1, themeSlot2, themeActiveSlot } = get();
      const activeRef = themeActiveSlot === 1 ? themeSlot1 : themeSlot2;
      if (activeRef === ref) {
        await get().applyActiveTheme();
      }

      return { ok: true, theme: entry, ref };
    },

    deleteCustomTheme: async (id) => {
      const ref = toCustomThemeRef(id);
      let { customThemes, themeSlot1, themeSlot2 } = get();
      customThemes = customThemes.filter((c) => c.id !== id);

      const patch = { customThemes };
      if (themeSlot1 === ref) {
        themeSlot1 = DEFAULT_SLOT1_PRESET;
        patch.themeSlot1 = themeSlot1;
        set({ themeSlot1 });
      }
      if (themeSlot2 === ref) {
        themeSlot2 = DEFAULT_SLOT2_PRESET;
        patch.themeSlot2 = themeSlot2;
        set({ themeSlot2 });
      }

      set({ customThemes });
      await persistThemeSettings(patch);
      await get().applyActiveTheme();
      return { ok: true };
    },

    createCustomThemeFromPreset: async (name, basePresetId) => {
      const theme = createCustomTheme(name, basePresetId);
      const res = await get().saveCustomTheme(theme);
      if (!res.ok) return res;
      return { ok: true, theme: res.theme, ref: toCustomThemeRef(res.theme.id) };
    },

    duplicateThemeAsCustom: async (themeRef) => {
      const { customThemes } = get();
      const dup = duplicateCustomTheme(themeRef, customThemes);
      if (!dup) return { ok: false, error: "Theme not found" };
      const res = await get().saveCustomTheme(dup);
      if (!res.ok) return res;
      return { ok: true, theme: res.theme, ref: toCustomThemeRef(res.theme.id) };
    },
  };
}
