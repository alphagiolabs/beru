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
  MoreHorizontal,
  Search,
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
import ThemeEditor from "./ThemeEditor.jsx";

const PREVIEW_SWATCH_KEYS = ["accentBrand", "bgSurface", "amber", "purple"];

function isDarkBackground(hex) {
  if (!hex || !hex.startsWith("#") || hex.length < 7) return true;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 < 140;
}

function ThemeColorThumb({ tokens, compact = false }) {
  if (!tokens)
    return <span className="settings-theme-thumb settings-theme-thumb--empty" aria-hidden="true" />;

  if (compact) {
    return (
      <div
        className="settings-theme-thumb settings-theme-thumb--compact"
        style={{ background: tokens.bgApp, borderColor: tokens.border }}
        aria-hidden="true"
      >
        <span
          className="settings-theme-thumb-surface"
          style={{ background: tokens.bgSurface, borderColor: tokens.border }}
        />
        <span className="settings-theme-thumb-accent" style={{ background: tokens.accentBrand }} />
      </div>
    );
  }

  return (
    <div className="settings-theme-preview" aria-hidden="true">
      <div
        className="settings-theme-preview-card"
        style={{ background: tokens.bgApp, borderColor: tokens.border }}
      >
        <span
          className="settings-theme-preview-bar"
          style={{ background: tokens.bgElevated, borderColor: tokens.border }}
        />
        <span
          className="settings-theme-preview-accent"
          style={{ background: tokens.accentBrand }}
        />
      </div>
      <div className="settings-theme-preview-swatches">
        {PREVIEW_SWATCH_KEYS.map((key) => (
          <span key={key} style={{ background: tokens[key] }} />
        ))}
      </div>
    </div>
  );
}

function ThemeListHeader({ t, withActions = false }) {
  return (
    <div
      className={`settings-theme-table-head${withActions ? " settings-theme-table-head--actions" : ""}`}
      aria-hidden="true"
    >
      <span />
      <span>{t("settings.appearance.themeColumn")}</span>
      <span
        className="settings-theme-table-slot-label"
        title={t("settings.appearance.useAsTheme1")}
      >
        <Sun size={10} strokeWidth={2.25} />
      </span>
      <span
        className="settings-theme-table-slot-label"
        title={t("settings.appearance.useAsTheme2")}
      >
        <Moon size={10} strokeWidth={2.25} />
      </span>
      {withActions ? <span /> : null}
    </div>
  );
}

function ThemeAssignRow({
  tokens,
  name,
  badge,
  themeRef,
  themeSlot1,
  themeSlot2,
  t,
  onAssign,
  actions,
}) {
  const inSlot1 = themeSlot1 === themeRef;
  const inSlot2 = themeSlot2 === themeRef;
  const isActive = inSlot1 || inSlot2;

  return (
    <div
      className={`settings-theme-row${isActive ? " settings-theme-row--active" : ""}${actions ? " settings-theme-row--actions" : ""}`}
    >
      <ThemeColorThumb tokens={tokens} />
      <div className="settings-theme-row-info">
        <span className="settings-theme-row-name">{name}</span>
        {badge}
      </div>
      <button
        type="button"
        className={`settings-theme-slot-btn${inSlot1 ? " settings-theme-slot-btn--active" : ""}`}
        title={t("settings.appearance.useAsTheme1")}
        aria-label={t("settings.appearance.useAsTheme1")}
        onClick={() => onAssign(1, themeRef)}
      >
        <Sun size={11} strokeWidth={2.25} />
      </button>
      <button
        type="button"
        className={`settings-theme-slot-btn${inSlot2 ? " settings-theme-slot-btn--active" : ""}`}
        title={t("settings.appearance.useAsTheme2")}
        aria-label={t("settings.appearance.useAsTheme2")}
        onClick={() => onAssign(2, themeRef)}
      >
        <Moon size={11} strokeWidth={2.25} />
      </button>
      {actions ? <div className="settings-theme-row-actions">{actions}</div> : null}
    </div>
  );
}

function ThemeLibraryRow({ preset, themeSlot1, themeSlot2, t, onAssign }) {
  return (
    <ThemeAssignRow
      tokens={preset.tokens}
      name={t(preset.nameKey)}
      themeRef={preset.id}
      themeSlot1={themeSlot1}
      themeSlot2={themeSlot2}
      t={t}
      onAssign={onAssign}
    />
  );
}

function CustomThemeRow({
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
    <ThemeAssignRow
      tokens={custom.tokens}
      name={custom.name}
      badge={
        isActive ? (
          <span className="settings-theme-row-badge">{t("settings.appearance.inUse")}</span>
        ) : null
      }
      themeRef={themeRef}
      themeSlot1={themeSlot1}
      themeSlot2={themeSlot2}
      t={t}
      onAssign={onAssign}
      actions={
        <details className="settings-theme-row-menu">
          <summary
            className="settings-theme-action-btn"
            aria-label={t("settings.appearance.moreActions")}
          >
            <MoreHorizontal size={11} />
          </summary>
          <div className="settings-theme-row-menu-panel">
            <button type="button" onClick={onEdit}>
              <Pencil size={11} />
              {t("settings.appearance.editColors")}
            </button>
            <button type="button" onClick={onDuplicate}>
              <Copy size={11} />
              {t("settings.appearance.duplicate")}
            </button>
            <button type="button" onClick={onExport}>
              <Download size={11} />
              {t("settings.appearance.export")}
            </button>
            <button type="button" className="settings-theme-row-menu-danger" onClick={onDelete}>
              <Trash2 size={11} />
              {t("common.delete")}
            </button>
          </div>
        </details>
      }
    />
  );
}

function ThemeLibraryColumn({ icon: Icon, title, count, children }) {
  return (
    <section className="settings-library-column">
      <header className="settings-library-column-head">
        <Icon size={12} strokeWidth={2.25} aria-hidden="true" />
        <span>{title}</span>
        <span className="settings-library-column-count">{count}</span>
      </header>
      <div className="settings-theme-table">{children}</div>
    </section>
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
      <div className="settings-appearance-slot-main">
        <div className="settings-appearance-slot-head">
          <div className="settings-appearance-slot-icon" aria-hidden="true">
            <Icon size={14} strokeWidth={2.25} />
          </div>
          <div className="settings-appearance-slot-meta">
            <span className="settings-appearance-slot-label">{label}</span>
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
        <ThemeColorThumb tokens={resolved?.tokens} compact />
      </div>
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
  const [customThemesExpanded, setCustomThemesExpanded] = useState(false);
  const [libraryQuery, setLibraryQuery] = useState("");

  const slot1Resolved = useMemo(
    () => resolveTheme(themeSlot1, customThemes) || resolveTheme(DEFAULT_SLOT1_PRESET, []),
    [themeSlot1, customThemes],
  );
  const slot2Resolved = useMemo(
    () => resolveTheme(themeSlot2, customThemes) || resolveTheme(DEFAULT_SLOT2_PRESET, []),
    [themeSlot2, customThemes],
  );

  const groupedPresets = useMemo(() => {
    const q = libraryQuery.trim().toLowerCase();
    const light = [];
    const dark = [];

    for (const preset of THEME_PRESETS) {
      const name = t(preset.nameKey).toLowerCase();
      if (q && !name.includes(q) && !preset.id.toLowerCase().includes(q)) continue;
      (isDarkBackground(preset.tokens.bgApp) ? dark : light).push(preset);
    }

    return { light, dark, total: light.length + dark.length };
  }, [libraryQuery, t]);

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
        <header className="settings-card-head settings-appearance-library-head">
          <div className="settings-appearance-library-title">
            <LayoutGrid size={14} strokeWidth={2.25} />
            <span>{t("settings.appearance.library")}</span>
            <span className="settings-users-count">{groupedPresets.total}</span>
          </div>
          <div className="settings-appearance-section-tools">
            <button
              type="button"
              className="settings-appearance-tool-btn"
              title={t("settings.appearance.import")}
              aria-label={t("settings.appearance.import")}
              onClick={handleImport}
            >
              <Upload size={12} />
              <span>{t("settings.appearance.import")}</span>
            </button>
            <button
              type="button"
              className="settings-appearance-tool-btn settings-appearance-tool-btn--primary"
              title={t("settings.appearance.createTheme")}
              aria-label={t("settings.appearance.createTheme")}
              onClick={handleCreateTheme}
            >
              <Plus size={12} />
              <span>{t("settings.appearance.createTheme")}</span>
            </button>
          </div>
        </header>

        <div className="settings-appearance-library-toolbar">
          <label className="settings-appearance-search">
            <Search size={12} aria-hidden="true" />
            <input
              type="search"
              className="cap-input"
              value={libraryQuery}
              placeholder={t("settings.appearance.searchThemes")}
              onChange={(e) => setLibraryQuery(e.target.value)}
            />
          </label>
        </div>

        <div className="settings-appearance-library-scroll">
          {groupedPresets.total === 0 ? (
            <p className="settings-theme-empty">{t("settings.appearance.noThemesFound")}</p>
          ) : (
            <div
              className={`settings-library-columns${groupedPresets.light.length > 0 && groupedPresets.dark.length > 0 ? "" : " settings-library-columns--single"}`}
            >
              {groupedPresets.light.length > 0 && (
                <ThemeLibraryColumn
                  icon={Sun}
                  title={t("settings.appearance.lightThemes")}
                  count={groupedPresets.light.length}
                >
                  <ThemeListHeader t={t} />
                  <div className="settings-theme-section-rows">
                    {groupedPresets.light.map((preset) => (
                      <ThemeLibraryRow
                        key={preset.id}
                        preset={preset}
                        themeSlot1={themeSlot1}
                        themeSlot2={themeSlot2}
                        t={t}
                        onAssign={assignThemeToSlot}
                      />
                    ))}
                  </div>
                </ThemeLibraryColumn>
              )}
              {groupedPresets.dark.length > 0 && (
                <ThemeLibraryColumn
                  icon={Moon}
                  title={t("settings.appearance.darkThemes")}
                  count={groupedPresets.dark.length}
                >
                  <ThemeListHeader t={t} />
                  <div className="settings-theme-section-rows">
                    {groupedPresets.dark.map((preset) => (
                      <ThemeLibraryRow
                        key={preset.id}
                        preset={preset}
                        themeSlot1={themeSlot1}
                        themeSlot2={themeSlot2}
                        t={t}
                        onAssign={assignThemeToSlot}
                      />
                    ))}
                  </div>
                </ThemeLibraryColumn>
              )}
            </div>
          )}

          {customThemes.length > 0 && (
            <div className="settings-theme-custom-block">
              <button
                type="button"
                className="settings-theme-fold"
                onClick={() => setCustomThemesExpanded((open) => !open)}
                aria-expanded={customThemesExpanded}
                aria-controls="settings-custom-themes-panel"
                aria-label={
                  customThemesExpanded
                    ? t("settings.appearance.collapseCustomThemes")
                    : t("settings.appearance.expandCustomThemes")
                }
              >
                <span className="settings-theme-fold-label">
                  <Pencil size={11} strokeWidth={2.25} aria-hidden="true" />
                  {t("settings.appearance.customThemes")}
                  <span className="settings-theme-fold-count">{customThemes.length}</span>
                </span>
                <ChevronDown
                  size={12}
                  strokeWidth={2.25}
                  className={`settings-theme-fold-chevron${customThemesExpanded ? "" : " settings-theme-fold-chevron--collapsed"}`}
                  aria-hidden="true"
                />
              </button>
              {customThemesExpanded && (
                <div id="settings-custom-themes-panel" className="settings-theme-table">
                  <ThemeListHeader t={t} withActions />
                  <div className="settings-theme-section-rows">
                    {customThemes.map((custom) => {
                      const ref = toCustomThemeRef(custom.id);
                      return (
                        <CustomThemeRow
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
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
