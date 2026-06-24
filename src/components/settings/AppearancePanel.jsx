import { useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  Copy,
  Download,
  LayoutGrid,
  Moon,
  Pencil,
  Plus,
  Sun,
  Trash2,
  Upload,
  Zap,
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

const LIBRARY_SWATCH_KEYS = ["accentBrand", "bgSurface", "amber", "rose", "purple"];

function isDarkBackground(hex) {
  if (!hex || !hex.startsWith("#") || hex.length < 7) return true;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 < 140;
}

function ThemeLibraryCard({ preset, themeSlot1, themeSlot2, t, onAssign }) {
  const inSlot1 = themeSlot1 === preset.id;
  const inSlot2 = themeSlot2 === preset.id;
  const isDark = isDarkBackground(preset.tokens.bgApp);

  return (
    <article
      className={`settings-library-card${inSlot1 || inSlot2 ? " settings-library-card--assigned" : ""}`}
    >
      <div className="settings-library-card-preview" style={{ background: preset.tokens.bgApp }}>
        <ThemePreviewCard tokens={preset.tokens} compact className="settings-library-card-thumb" />
        <div className="settings-library-card-swatches" aria-hidden="true">
          {LIBRARY_SWATCH_KEYS.map((key) => (
            <span
              key={key}
              className="settings-library-card-swatch"
              style={{ background: preset.tokens[key] }}
            />
          ))}
        </div>
      </div>
      <div className="settings-library-card-footer">
        <div className="settings-library-card-meta">
          <span className="settings-library-card-name">{t(preset.nameKey)}</span>
          <span
            className={`settings-library-card-tone ${isDark ? "settings-library-card-tone--dark" : "settings-library-card-tone--light"}`}
          >
            {isDark ? t("settings.appearance.toneDark") : t("settings.appearance.toneLight")}
          </span>
        </div>
        <div className="settings-library-card-actions">
          <button
            type="button"
            className={`settings-library-slot-btn${inSlot1 ? " settings-library-slot-btn--active" : ""}`}
            onClick={() => onAssign(1, preset.id)}
          >
            {t("settings.appearance.useAsTheme1")}
          </button>
          <button
            type="button"
            className={`settings-library-slot-btn${inSlot2 ? " settings-library-slot-btn--active" : ""}`}
            onClick={() => onAssign(2, preset.id)}
          >
            {t("settings.appearance.useAsTheme2")}
          </button>
        </div>
      </div>
    </article>
  );
}

function CustomThemeCard({
  custom,
  themeRef,
  themeSlot1,
  themeSlot2,
  t,
  onAssign,
  onEdit,
  onDuplicate,
  onExport,
  onDelete,
}) {
  const inSlot1 = themeSlot1 === themeRef;
  const inSlot2 = themeSlot2 === themeRef;
  const isActive = inSlot1 || inSlot2;

  return (
    <article className={`settings-custom-card${isActive ? " settings-custom-card--assigned" : ""}`}>
      <div className="settings-custom-card-preview" style={{ background: custom.tokens.bgApp }}>
        <ThemePreviewCard tokens={custom.tokens} compact className="settings-library-card-thumb" />
        <div className="settings-library-card-swatches" aria-hidden="true">
          {LIBRARY_SWATCH_KEYS.map((key) => (
            <span
              key={key}
              className="settings-library-card-swatch"
              style={{ background: custom.tokens[key] }}
            />
          ))}
        </div>
      </div>
      <div className="settings-custom-card-footer">
        <div className="settings-custom-card-meta">
          <span className="settings-library-card-name">{custom.name}</span>
          {isActive && (
            <span className="settings-custom-card-badge">{t("settings.appearance.inUse")}</span>
          )}
        </div>
        <div className="settings-library-card-actions">
          <button
            type="button"
            className={`settings-library-slot-btn${inSlot1 ? " settings-library-slot-btn--active" : ""}`}
            onClick={() => onAssign(1, themeRef)}
          >
            {t("settings.appearance.useAsTheme1")}
          </button>
          <button
            type="button"
            className={`settings-library-slot-btn${inSlot2 ? " settings-library-slot-btn--active" : ""}`}
            onClick={() => onAssign(2, themeRef)}
          >
            {t("settings.appearance.useAsTheme2")}
          </button>
        </div>
        <div className="settings-custom-toolbar">
          <button
            type="button"
            className="settings-custom-tool-btn"
            title={t("settings.appearance.editColors")}
            onClick={onEdit}
          >
            <Pencil size={12} />
          </button>
          <button
            type="button"
            className="settings-custom-tool-btn"
            title={t("settings.appearance.duplicate")}
            onClick={onDuplicate}
          >
            <Copy size={12} />
          </button>
          <button
            type="button"
            className="settings-custom-tool-btn"
            title={t("settings.appearance.export")}
            onClick={onExport}
          >
            <Download size={12} />
          </button>
          <button
            type="button"
            className="settings-custom-tool-btn settings-custom-tool-btn--danger"
            title={t("common.delete")}
            onClick={onDelete}
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    </article>
  );
}

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

function ThemeSlot({
  icon: Icon,
  label,
  hint,
  themeRef,
  resolved,
  isActive,
  customThemes,
  t,
  onAssign,
  onActivate,
  onEdit,
}) {
  return (
    <div
      className={`settings-appearance-slot ${isActive ? "settings-appearance-slot--active" : ""}`}
    >
      <div className="settings-appearance-slot-head">
        <div className="settings-appearance-slot-icon" aria-hidden="true">
          <Icon size={14} strokeWidth={2.25} />
        </div>
        <div className="settings-appearance-slot-meta">
          <span className="settings-appearance-slot-label">{label}</span>
          <span className="settings-appearance-slot-hint">{hint}</span>
          <span className="settings-appearance-slot-theme">
            {resolveThemeName(themeRef, customThemes, t)}
          </span>
        </div>
        {isActive && (
          <span className="settings-appearance-slot-badge">
            <Check size={10} />
            {t("settings.appearance.active")}
          </span>
        )}
      </div>
      <ThemePreviewCard tokens={resolved?.tokens} compact />
      <ThemeRefSelect value={themeRef} customThemes={customThemes} t={t} onChange={onAssign} />
      <div className="settings-appearance-slot-actions">
        <button type="button" className="cap-btn-secondary" onClick={onEdit}>
          <Pencil size={12} />
          {t("settings.appearance.editColors")}
        </button>
        {!isActive && (
          <button type="button" className="cap-btn-secondary" onClick={onActivate}>
            {t("settings.appearance.applyNow")}
          </button>
        )}
      </div>
    </div>
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
  const [customThemesExpanded, setCustomThemesExpanded] = useState(true);

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
      <section className="settings-card settings-appearance-quick-card">
        <header className="settings-card-head">
          <div className="settings-card-head-left">
            <Zap size={14} strokeWidth={2.25} />
            <span>{t("settings.appearance.quickAccess")}</span>
          </div>
        </header>
        <div className="settings-appearance-quick-scroll">
          <div className="settings-appearance-slots">
            <ThemeSlot
              icon={Sun}
              label={t("settings.appearance.theme1")}
              hint={t("settings.appearance.theme1Hint")}
              themeRef={themeSlot1}
              resolved={slot1Resolved}
              isActive={themeActiveSlot === 1}
              customThemes={customThemes}
              t={t}
              onAssign={(e) => assignThemeToSlot(1, e.target.value)}
              onActivate={() => setThemeActiveSlot(1)}
              onEdit={() => openEditorForRef(themeSlot1, 1)}
            />
            <ThemeSlot
              icon={Moon}
              label={t("settings.appearance.theme2")}
              hint={t("settings.appearance.theme2Hint")}
              themeRef={themeSlot2}
              resolved={slot2Resolved}
              isActive={themeActiveSlot === 2}
              customThemes={customThemes}
              t={t}
              onAssign={(e) => assignThemeToSlot(2, e.target.value)}
              onActivate={() => setThemeActiveSlot(2)}
              onEdit={() => openEditorForRef(themeSlot2, 2)}
            />
          </div>
        </div>
      </section>

      <section className="settings-card settings-appearance-library-card">
        <header className="settings-card-head">
          <div className="settings-card-head-left">
            <LayoutGrid size={14} strokeWidth={2.25} />
            <span>{t("settings.appearance.library")}</span>
          </div>
          <div className="settings-appearance-section-tools">
            <span className="settings-users-count">{THEME_PRESETS.length}</span>
            <button type="button" className="cap-btn-secondary" onClick={handleImport}>
              <Upload size={12} />
              {t("settings.appearance.import")}
            </button>
            <button type="button" className="cap-btn-primary" onClick={handleCreateTheme}>
              <Plus size={12} />
              {t("settings.appearance.createTheme")}
            </button>
          </div>
        </header>
        <p className="settings-library-hint">{t("settings.appearance.libraryHint")}</p>
        <div className="settings-appearance-library-scroll">
          <div className="settings-appearance-grid">
            {THEME_PRESETS.map((preset) => (
              <ThemeLibraryCard
                key={preset.id}
                preset={preset}
                themeSlot1={themeSlot1}
                themeSlot2={themeSlot2}
                t={t}
                onAssign={assignThemeToSlot}
              />
            ))}
          </div>
        </div>
      </section>

      {customThemes.length > 0 && (
        <section
          className={`settings-card settings-appearance-custom--full${customThemesExpanded ? "" : " settings-appearance-custom--collapsed"}`}
        >
          <header className="settings-card-head">
            <button
              type="button"
              className="settings-card-collapse-trigger"
              onClick={() => setCustomThemesExpanded((open) => !open)}
              aria-expanded={customThemesExpanded}
              aria-controls="settings-custom-themes-panel"
              aria-label={
                customThemesExpanded
                  ? t("settings.appearance.collapseCustomThemes")
                  : t("settings.appearance.expandCustomThemes")
              }
            >
              <div className="settings-card-head-left">
                <Pencil size={14} strokeWidth={2.25} />
                <span>{t("settings.appearance.customThemes")}</span>
              </div>
              <span className="settings-card-collapse-tools">
                <span className="settings-users-count">{customThemes.length}</span>
                <ChevronDown
                  size={14}
                  strokeWidth={2.25}
                  className={`settings-card-collapse-icon${customThemesExpanded ? "" : " settings-card-collapse-icon--collapsed"}`}
                  aria-hidden="true"
                />
              </span>
            </button>
          </header>
          {customThemesExpanded && (
            <div id="settings-custom-themes-panel" className="settings-custom-grid">
              {customThemes.map((custom) => {
                const ref = toCustomThemeRef(custom.id);
                return (
                  <CustomThemeCard
                    key={custom.id}
                    custom={custom}
                    themeRef={ref}
                    themeSlot1={themeSlot1}
                    themeSlot2={themeSlot2}
                    t={t}
                    onAssign={assignThemeToSlot}
                    onEdit={() =>
                      setEditorState({
                        mode: "edit",
                        themeRef: ref,
                        id: custom.id,
                        name: custom.name,
                        tokens: custom.tokens,
                        basePresetId: DEFAULT_SLOT2_PRESET,
                      })
                    }
                    onDuplicate={async () => {
                      const res = await duplicateThemeAsCustom(ref);
                      if (res.ok)
                        showToast({ kind: "ok", text: t("settings.appearance.duplicated") });
                    }}
                    onExport={() => handleExport(custom)}
                    onDelete={() => handleDeleteCustom(custom.id)}
                  />
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
