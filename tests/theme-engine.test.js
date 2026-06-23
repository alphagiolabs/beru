import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { THEME_PRESETS, getPresetById } from "../src/theme/presets.js";
import {
  applyThemeTokens,
  createCustomTheme,
  deriveWindowChrome,
  duplicateCustomTheme,
  isValidThemeRef,
  migrateThemeSettings,
  resolveTheme,
  resolveThemeName,
  sanitizeCustomThemes,
  slotToLegacyTheme,
  toCustomThemeRef,
  validateThemeTokens,
} from "../src/theme/engine.js";
import { CSS_VAR_MAP, DEFAULT_SLOT1_PRESET, DEFAULT_SLOT2_PRESET } from "../src/theme/tokens.js";

describe("theme engine", () => {
  it("exposes at least 11 built-in presets", () => {
    expect(THEME_PRESETS.length).toBeGreaterThanOrEqual(11);
    expect(getPresetById("beru-dark")).toBeTruthy();
    expect(getPresetById("beru-light")).toBeTruthy();
    expect(getPresetById("ocean")).toBeTruthy();
  });

  it("validates preset tokens", () => {
    for (const preset of THEME_PRESETS) {
      expect(validateThemeTokens(preset.tokens).ok).toBe(true);
    }
  });

  it("resolves preset and custom themes", () => {
    const custom = createCustomTheme("Test", "ocean");
    const ref = toCustomThemeRef(custom.id);
    expect(resolveTheme("ocean", [])?.tokens.bgApp).toBe("#041e26");
    expect(resolveTheme(ref, [custom])?.name).toBe("Test");
    expect(resolveTheme("missing", [])).toBeNull();
  });

  it("migrates legacy theme settings", () => {
    const dark = migrateThemeSettings({ theme: "dark" });
    expect(dark.themeSlot1).toBe(DEFAULT_SLOT1_PRESET);
    expect(dark.themeSlot2).toBe(DEFAULT_SLOT2_PRESET);
    expect(dark.themeActiveSlot).toBe(2);
    expect(dark.theme).toBe("dark");
    expect(dark.needsMigrationSave).toBe(true);

    const light = migrateThemeSettings({ theme: "light" });
    expect(light.themeActiveSlot).toBe(1);
    expect(light.theme).toBe("light");
  });

  it("keeps new schema settings and sanitizes invalid refs", () => {
    const custom = createCustomTheme("Mine");
    const ref = toCustomThemeRef(custom.id);
    const migrated = migrateThemeSettings({
      themeActiveSlot: 1,
      themeSlot1: ref,
      themeSlot2: "ocean",
      customThemes: [custom],
      theme: "light",
    });
    expect(migrated.themeSlot1).toBe(ref);
    expect(migrated.themeSlot2).toBe("ocean");
    expect(migrated.activeThemeRef).toBe(ref);
    expect(migrated.needsMigrationSave).toBe(false);
  });

  it("falls back invalid slot refs to defaults", () => {
    const migrated = migrateThemeSettings({
      themeActiveSlot: 2,
      themeSlot1: "invalid-preset",
      themeSlot2: "custom:missing",
      customThemes: [],
    });
    expect(migrated.themeSlot1).toBe(DEFAULT_SLOT1_PRESET);
    expect(migrated.themeSlot2).toBe(DEFAULT_SLOT2_PRESET);
  });

  it("applies tokens to document CSS variables", () => {
    const preset = getPresetById("beru-light");
    applyThemeTokens(preset.tokens, 1);
    expect(document.documentElement.style.getPropertyValue(CSS_VAR_MAP.bgApp)).toBe("#f5f5f5");
    expect(document.documentElement.getAttribute("data-theme-slot")).toBe("1");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("derives electron window chrome from tokens", () => {
    const preset = getPresetById("beru-dark");
    expect(deriveWindowChrome(preset.tokens)).toEqual({
      background: "#0a0a0a",
      symbols: "#ffffff",
    });
  });

  it("duplicates themes including presets", () => {
    const dup = duplicateCustomTheme("ocean", []);
    expect(dup?.tokens.bgApp).toBe("#041e26");
    expect(dup?.name).toContain("copy");
  });

  it("validates theme refs", () => {
    const custom = createCustomTheme("X");
    expect(isValidThemeRef("ocean", [])).toBe(true);
    expect(isValidThemeRef(toCustomThemeRef(custom.id), [custom])).toBe(true);
    expect(isValidThemeRef("custom:missing", [])).toBe(false);
  });

  it("maps slots to legacy theme names", () => {
    expect(slotToLegacyTheme(1)).toBe("light");
    expect(slotToLegacyTheme(2)).toBe("dark");
  });

  it("sanitizes malformed custom themes", () => {
    const valid = createCustomTheme("Good");
    const sanitized = sanitizeCustomThemes([
      valid,
      { id: "bad", name: 123 },
      { id: "x", name: "X", tokens: { bgApp: "not-a-color" } },
    ]);
    expect(sanitized).toHaveLength(1);
    expect(sanitized[0].name).toBe("Good");
  });

  it("resolves theme names via i18n callback", () => {
    const t = (key) => (key === "theme.preset.ocean" ? "Océano" : key);
    expect(resolveThemeName("ocean", [], t)).toBe("Océano");
    const custom = createCustomTheme("Mi tema");
    expect(resolveThemeName(toCustomThemeRef(custom.id), [custom], t)).toBe("Mi tema");
  });
});

describe("uiSlice theme actions", () => {
  const mockApi = {
    loadSettings: vi.fn(),
    saveSettings: vi.fn(async () => ({ success: true })),
    setWindowTheme: vi.fn(async () => ({ success: true })),
  };

  beforeEach(async () => {
    vi.resetModules();
    globalThis.window = { api: mockApi };
    mockApi.loadSettings.mockReset();
    mockApi.saveSettings.mockReset();
    mockApi.setWindowTheme.mockReset();
    mockApi.saveSettings.mockResolvedValue({ success: true });
    mockApi.setWindowTheme.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-theme-slot");
    for (const cssVar of Object.values(CSS_VAR_MAP)) {
      document.documentElement.style.removeProperty(cssVar);
    }
  });

  it("loads settings with migration and applies active theme", async () => {
    mockApi.loadSettings.mockResolvedValue({ theme: "light", language: "es" });
    const { default: useEditorStore } = await import("../src/stores/useEditorStore.js");

    const res = await useEditorStore.getState().loadSettings();
    expect(res.ok).toBe(true);

    const state = useEditorStore.getState();
    expect(state.themeActiveSlot).toBe(1);
    expect(state.themeSlot1).toBe(DEFAULT_SLOT1_PRESET);
    expect(state.themeSlot2).toBe(DEFAULT_SLOT2_PRESET);
    expect(document.documentElement.style.getPropertyValue(CSS_VAR_MAP.bgApp)).toBe("#f5f5f5");
    expect(mockApi.setWindowTheme).toHaveBeenCalledWith({
      background: "#f5f5f5",
      symbols: "#0a0a0a",
    });
    expect(mockApi.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        themeActiveSlot: 1,
        themeSlot1: DEFAULT_SLOT1_PRESET,
        themeSlot2: DEFAULT_SLOT2_PRESET,
      }),
    );
  });

  it("toggleTheme switches slots and persists", async () => {
    mockApi.loadSettings.mockResolvedValue({
      themeActiveSlot: 1,
      themeSlot1: DEFAULT_SLOT1_PRESET,
      themeSlot2: "ocean",
      customThemes: [],
      theme: "light",
      language: "es",
    });
    const { default: useEditorStore } = await import("../src/stores/useEditorStore.js");
    await useEditorStore.getState().loadSettings();
    mockApi.saveSettings.mockClear();
    mockApi.setWindowTheme.mockClear();

    await useEditorStore.getState().toggleTheme();

    const state = useEditorStore.getState();
    expect(state.themeActiveSlot).toBe(2);
    expect(document.documentElement.style.getPropertyValue(CSS_VAR_MAP.bgApp)).toBe("#041e26");
    expect(mockApi.saveSettings).toHaveBeenCalledWith({ themeActiveSlot: 2, theme: "dark" });
    expect(mockApi.setWindowTheme).toHaveBeenCalledWith({
      background: "#041e26",
      symbols: "#e0f7fa",
    });
  });

  it("assignThemeToSlot updates active slot theme immediately", async () => {
    mockApi.loadSettings.mockResolvedValue({
      themeActiveSlot: 2,
      themeSlot1: DEFAULT_SLOT1_PRESET,
      themeSlot2: DEFAULT_SLOT2_PRESET,
      customThemes: [],
      theme: "dark",
      language: "es",
    });
    const { default: useEditorStore } = await import("../src/stores/useEditorStore.js");
    await useEditorStore.getState().loadSettings();

    await useEditorStore.getState().assignThemeToSlot(2, "forest");
    expect(useEditorStore.getState().themeSlot2).toBe("forest");
    expect(document.documentElement.style.getPropertyValue(CSS_VAR_MAP.bgApp)).toBe("#0a120a");
  });

  it("saveCustomTheme re-applies only when active slot uses the theme", async () => {
    mockApi.loadSettings.mockResolvedValue({
      themeActiveSlot: 2,
      themeSlot1: DEFAULT_SLOT1_PRESET,
      themeSlot2: DEFAULT_SLOT2_PRESET,
      customThemes: [],
      theme: "dark",
      language: "es",
    });
    const { default: useEditorStore } = await import("../src/stores/useEditorStore.js");
    await useEditorStore.getState().loadSettings();

    const created = await useEditorStore.getState().createCustomThemeFromPreset("Custom");
    expect(created.ok).toBe(true);

    await useEditorStore.getState().assignThemeToSlot(1, created.ref);
    mockApi.setWindowTheme.mockClear();

    const custom = useEditorStore.getState().customThemes.find((c) => c.id === created.theme.id);
    custom.tokens = { ...custom.tokens, bgApp: "#123456" };
    await useEditorStore.getState().saveCustomTheme(custom);

    expect(document.documentElement.style.getPropertyValue(CSS_VAR_MAP.bgApp)).toBe("#0a0a0a");

    await useEditorStore.getState().setThemeActiveSlot(1);
    custom.tokens = { ...custom.tokens, bgApp: "#abcdef" };
    await useEditorStore.getState().saveCustomTheme(custom);
    expect(document.documentElement.style.getPropertyValue(CSS_VAR_MAP.bgApp)).toBe("#abcdef");
  });
});
