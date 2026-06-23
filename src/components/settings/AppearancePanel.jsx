import { useMemo, useState } from "react";
import {
  Check,
  Copy,
  Download,
  Moon,
  Palette,
  Pencil,
  Plus,
  Sun,
  Trash2,
  Upload,
} from "lucide-react";
import useEditorStore from "../../stores/useEditorStore";
import { useT } from "../../i18n/useT";
import { THEME_PRESETS } from "../../theme/presets.js";
import {
  customThemeId,
  isCustomThemeRef,
  resolveTheme,
  resolveThemeName,
  toCustomThemeRef,
  validateThemeTokens,
} from "../../theme/engine.js";
import { DEFAULT_SLOT1_PRESET, DEFAULT_SLOT2_PRESET } from "../../theme/tokens.js";
import ThemePreviewCard from "./ThemePreviewCard.jsx";
import ThemeEditor from "./ThemeEditor.jsx";

function ThemeRefSelect({ value, customThemes, onChange, t }) {
  return (
    <select className="cap-input settings-appearance-select" value={value} onChange={onChange}>
      <optgroup label={t("settings.appearance.presets")}>
        {THEME_PRESETS.map((p) => (
          <option key={p.id} value={p.id}>
            {t(p.nameKey)}
          </option>
        ))}
      </optgroup>
      {customThemes.length > 0 && (
        <optgroup label={t("settings.appearance.customThemes")}>
          {customThemes.map((c) => (
            <option key={c.id} value={toCustomThemeRef(c.id)}>
              {c.name}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}

export default function AppearancePanel() {
  const t = useT();
  const themeActiveSlot = useEditorStore((s) => s.themeActiveSlot);
  const themeSlot1 = useEditorStore((s) => s.themeSlot1);
  const themeSlot2 = useEditorStore((s) => s.themeSlot2);
  const customThemes = useEditorStore((s) => s.customThemes);
  const assignThemeToSlot = useEditorStore((s) => s.assignThemeToSlot);
  const setThemeActiveSlot = useEditorStore((s) => s.setThemeActiveSlot);
  const saveCustomTheme = useEditorStore((s) => s.saveCustomTheme);
  const deleteCustomTheme = useEditorStore((s) => s.deleteCustomTheme);
  const createCustomThemeFromPreset = useEditorStore((s) => s.createCustomThemeFromPreset);
  const duplicateThemeAsCustom = useEditorStore((s) => s.duplicateThemeAsCustom);
  const showToast = useEditorStore((s) => s.showToast);
  const requestConfirm = useEditorStore((s) => s.requestConfirm);

  const [editorState, setEditorState] = useState(null);

  const slot1Resolved = useMemo(
    () => resolveTheme(themeSlot1, customThemes) || resolveTheme(DEFAULT_SLOT1_PRESET, []),
    [themeSlot1, customThemes],
  );
  const slot2Resolved = useMemo(
    () => resolveTheme(themeSlot2, customThemes) || resolveTheme(DEFAULT_SLOT2_PRESET, []),
    [themeSlot2, customThemes],
  );

  const openEditorForRef = async (themeRef, slot) => {
    const basePresetId = slot === 1 ? DEFAULT_SLOT1_PRESET : DEFAULT_SLOT2_PRESET;
    const resolved = resolveTheme(themeRef, customThemes);
    if (isCustomThemeRef(themeRef) && resolved) {
      setEditorState({
        mode: "edit",
        themeRef,
        id: customThemeId(themeRef),
        name: resolved.name,
        tokens: resolved.tokens,
        basePresetId,
      });
      return;
    }
    const res = await duplicateThemeAsCustom(themeRef);
    if (!res.ok) {
      showToast({ kind: "err", text: res.error || t("settings.appearance.editFailed") });
      return;
    }
    setEditorState({
      mode: "edit",
      themeRef: res.ref,
      id: res.theme.id,
      name: res.theme.name,
      tokens: res.theme.tokens,
      basePresetId: themeRef,
    });
    await assignThemeToSlot(slot, res.ref);
  };

  const handleEditorSave = async ({ name, tokens }) => {
    if (!editorState) return;
    const res = await saveCustomTheme({
      id: editorState.id,
      name,
      tokens,
      createdAt: editorState.createdAt,
    });
    if (!res.ok) {
      showToast({ kind: "err", text: res.error || t("settings.appearance.saveFailed") });
      return;
    }
    showToast({ kind: "ok", text: t("settings.appearance.themeSaved") });
    setEditorState(null);
  };

  const handleCreateTheme = async () => {
    const res = await createCustomThemeFromPreset(t("settings.appearance.newThemeName"));
    if (!res.ok) {
      showToast({ kind: "err", text: res.error || t("settings.appearance.createFailed") });
      return;
    }
    setEditorState({
      mode: "edit",
      themeRef: res.ref,
      id: res.theme.id,
      name: res.theme.name,
      tokens: res.theme.tokens,
      basePresetId: DEFAULT_SLOT2_PRESET,
    });
  };

  const handleDeleteCustom = async (id) => {
    const ok = await requestConfirm({
      message: t("settings.appearance.confirmDelete"),
      confirmLabel: t("common.delete"),
      variant: "danger",
    });
    if (!ok) return;
    await deleteCustomTheme(id);
    showToast({ kind: "ok", text: t("settings.appearance.themeDeleted") });
  };

  const handleExport = (theme) => {
    const blob = new Blob([JSON.stringify(theme, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${theme.name.replace(/\s+/g, "-").toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const raw = JSON.parse(await file.text());
        const validation = validateThemeTokens(raw.tokens);
        if (!validation.ok) throw new Error(validation.error);
        const res = await saveCustomTheme({
          id: raw.id,
          name: raw.name || t("settings.appearance.importedTheme"),
          tokens: raw.tokens,
        });
        if (!res.ok) throw new Error(res.error);
        showToast({ kind: "ok", text: t("settings.appearance.importSuccess") });
      } catch (e) {
        showToast({ kind: "err", text: e.message || t("settings.appearance.importFailed") });
      }
    };
    input.click();
  };

  if (editorState) {
    return (
      <ThemeEditor
        themeRef={editorState.themeRef}
        initialName={editorState.name}
        initialTokens={editorState.tokens}
        basePresetId={editorState.basePresetId}
        onSave={handleEditorSave}
        onCancel={() => setEditorState(null)}
      />
    );
  }

  return (
    <div className="settings-appearance">
      <div className="settings-appearance-intro">
        <div className="settings-appearance-intro-icon" aria-hidden="true">
          <Palette size={16} />
        </div>
        <div>
          <h3 className="settings-appearance-title">{t("settings.appearance.title")}</h3>
          <p className="settings-appearance-sub">{t("settings.appearance.subtitle")}</p>
        </div>
      </div>

      <section className="settings-appearance-section">
        <h4 className="settings-appearance-section-title">{t("settings.appearance.quickAccess")}</h4>
        <div className="settings-appearance-slots">
          <div
            className={`settings-appearance-slot ${themeActiveSlot === 1 ? "settings-appearance-slot--active" : ""}`}
          >
            <div className="settings-appearance-slot-head">
              <Sun size={14} />
              <div>
                <span className="settings-appearance-slot-label">{t("settings.appearance.theme1")}</span>
                <span className="settings-appearance-slot-hint">{t("settings.appearance.theme1Hint")}</span>
              </div>
              {themeActiveSlot === 1 && (
                <span className="settings-appearance-slot-badge">
                  <Check size={10} />
                  {t("settings.appearance.active")}
                </span>
              )}
            </div>
            <ThemePreviewCard tokens={slot1Resolved?.tokens} compact />
            <ThemeRefSelect
              value={themeSlot1}
              customThemes={customThemes}
              t={t}
              onChange={(e) => assignThemeToSlot(1, e.target.value)}
            />
            <div className="settings-appearance-slot-actions">
              <button
                type="button"
                className="cap-btn-secondary"
                onClick={() => openEditorForRef(themeSlot1, 1)}
              >
                <Pencil size={12} />
                {t("settings.appearance.editColors")}
              </button>
              {themeActiveSlot !== 1 && (
                <button
                  type="button"
                  className="cap-btn-secondary"
                  onClick={() => setThemeActiveSlot(1)}
                >
                  {t("settings.appearance.applyNow")}
                </button>
              )}
            </div>
          </div>

          <div
            className={`settings-appearance-slot ${themeActiveSlot === 2 ? "settings-appearance-slot--active" : ""}`}
          >
            <div className="settings-appearance-slot-head">
              <Moon size={14} />
              <div>
                <span className="settings-appearance-slot-label">{t("settings.appearance.theme2")}</span>
                <span className="settings-appearance-slot-hint">{t("settings.appearance.theme2Hint")}</span>
              </div>
              {themeActiveSlot === 2 && (
                <span className="settings-appearance-slot-badge">
                  <Check size={10} />
                  {t("settings.appearance.active")}
                </span>
              )}
            </div>
            <ThemePreviewCard tokens={slot2Resolved?.tokens} compact />
            <ThemeRefSelect
              value={themeSlot2}
              customThemes={customThemes}
              t={t}
              onChange={(e) => assignThemeToSlot(2, e.target.value)}
            />
            <div className="settings-appearance-slot-actions">
              <button
                type="button"
                className="cap-btn-secondary"
                onClick={() => openEditorForRef(themeSlot2, 2)}
              >
                <Pencil size={12} />
                {t("settings.appearance.editColors")}
              </button>
              {themeActiveSlot !== 2 && (
                <button
                  type="button"
                  className="cap-btn-secondary"
                  onClick={() => setThemeActiveSlot(2)}
                >
                  {t("settings.appearance.applyNow")}
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="settings-appearance-section">
        <div className="settings-appearance-section-head">
          <h4 className="settings-appearance-section-title">{t("settings.appearance.library")}</h4>
          <div className="settings-appearance-section-tools">
            <button type="button" className="cap-btn-secondary" onClick={handleImport}>
              <Upload size={12} />
              {t("settings.appearance.import")}
            </button>
            <button type="button" className="cap-btn-primary" onClick={handleCreateTheme}>
              <Plus size={12} />
              {t("settings.appearance.createTheme")}
            </button>
          </div>
        </div>
        <div className="settings-appearance-grid">
          {THEME_PRESETS.map((preset) => (
            <div key={preset.id} className="settings-appearance-grid-item">
              <ThemePreviewCard tokens={preset.tokens} compact />
              <span className="settings-appearance-grid-name">{t(preset.nameKey)}</span>
              <div className="settings-appearance-grid-actions">
                <button
                  type="button"
                  className="cap-btn-secondary !text-[10px]"
                  onClick={() => assignThemeToSlot(1, preset.id)}
                >
                  {t("settings.appearance.useAsTheme1")}
                </button>
                <button
                  type="button"
                  className="cap-btn-secondary !text-[10px]"
                  onClick={() => assignThemeToSlot(2, preset.id)}
                >
                  {t("settings.appearance.useAsTheme2")}
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {customThemes.length > 0 && (
        <section className="settings-appearance-section">
          <h4 className="settings-appearance-section-title">{t("settings.appearance.customThemes")}</h4>
          <div className="settings-appearance-custom-list">
            {customThemes.map((custom) => {
              const ref = toCustomThemeRef(custom.id);
              const isActive = themeSlot1 === ref || themeSlot2 === ref;
              return (
                <div key={custom.id} className="settings-appearance-custom-row">
                  <ThemePreviewCard tokens={custom.tokens} compact className="!w-[88px]" />
                  <div className="settings-appearance-custom-info">
                    <span className="settings-appearance-custom-name">{custom.name}</span>
                    {isActive && (
                      <span className="settings-appearance-custom-active">
                        {t("settings.appearance.inUse")}
                      </span>
                    )}
                  </div>
                  <div className="settings-appearance-custom-actions">
                    <button
                      type="button"
                      className="cap-btn-secondary !p-1.5"
                      title={t("settings.appearance.editColors")}
                      onClick={() =>
                        setEditorState({
                          mode: "edit",
                          themeRef: ref,
                          id: custom.id,
                          name: custom.name,
                          tokens: custom.tokens,
                          basePresetId: DEFAULT_SLOT2_PRESET,
                        })
                      }
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      type="button"
                      className="cap-btn-secondary !p-1.5"
                      title={t("settings.appearance.duplicate")}
                      onClick={async () => {
                        const res = await duplicateThemeAsCustom(ref);
                        if (res.ok) showToast({ kind: "ok", text: t("settings.appearance.duplicated") });
                      }}
                    >
                      <Copy size={12} />
                    </button>
                    <button
                      type="button"
                      className="cap-btn-secondary !p-1.5"
                      title={t("settings.appearance.export")}
                      onClick={() => handleExport(custom)}
                    >
                      <Download size={12} />
                    </button>
                    <button
                      type="button"
                      className="cap-btn-secondary !p-1.5"
                      title={t("common.delete")}
                      onClick={() => handleDeleteCustom(custom.id)}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

export function getActiveThemeDisplayName(state, t) {
  const ref = state.themeActiveSlot === 1 ? state.themeSlot1 : state.themeSlot2;
  return resolveThemeName(ref, state.customThemes, t);
}
