import { useCallback, useEffect, useState } from "react";
import { RotateCcw, Save, X } from "lucide-react";
import { useT } from "../../i18n/useT";
import useEditorStore from "../../stores/useEditorStore";
import { applyThemeTokens, validateThemeTokens } from "../../theme/engine.js";
import { TOKEN_LABEL_KEYS } from "../../theme/tokens.js";
import { getPresetById } from "../../theme/presets.js";
import ThemePreviewCard from "./ThemePreviewCard.jsx";

const TOKEN_GROUPS = [
  {
    id: "backgrounds",
    labelKey: "settings.appearance.editor.groupBackgrounds",
    keys: ["bgApp", "bgSurface", "bgElevated"],
  },
  {
    id: "text",
    labelKey: "settings.appearance.editor.groupText",
    keys: ["textPrimary", "textSecondary", "textDim"],
  },
  {
    id: "brand",
    labelKey: "settings.appearance.editor.groupBrand",
    keys: ["accent", "accentBrand", "accentBrandDim"],
  },
  {
    id: "semantic",
    labelKey: "settings.appearance.editor.groupSemantic",
    keys: ["amber", "rose", "purple"],
  },
  {
    id: "effects",
    labelKey: "settings.appearance.editor.groupEffects",
    keys: ["border", "overlay", "modalShadow"],
    wide: true,
  },
];

const PREVIEW_SWATCH_KEYS = [
  "bgApp",
  "bgSurface",
  "accentBrand",
  "textPrimary",
  "amber",
  "rose",
  "purple",
  "border",
];

function hexToColorInput(val) {
  if (!val || typeof val !== "string") return "#000000";
  const m = val.match(/^#([0-9a-fA-F]{6})$/);
  if (m) return `#${m[1]}`;
  const m3 = val.match(/^#([0-9a-fA-F]{3})$/);
  if (m3) {
    const [r, g, b] = m3[1].split("");
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return "#808080";
}

function isSimpleColor(val) {
  return /^#[0-9a-fA-F]{3,8}$/.test(val?.trim?.() || "");
}

function TokenField({ tokenKey, value, onChange, t }) {
  const simple = isSimpleColor(value);
  const showPicker = simple && tokenKey !== "modalShadow";

  return (
    <div className="theme-token-row">
      <span className="theme-token-label">{t(TOKEN_LABEL_KEYS[tokenKey])}</span>
      <div className="theme-token-control">
        {showPicker ? (
          <label className="theme-token-swatch-wrap" title={t(TOKEN_LABEL_KEYS[tokenKey])}>
            <span className="theme-token-swatch" style={{ background: value }} aria-hidden="true" />
            <input
              type="color"
              className="theme-token-color-input"
              value={hexToColorInput(value)}
              onChange={(e) => onChange(tokenKey, e.target.value)}
              aria-label={t(TOKEN_LABEL_KEYS[tokenKey])}
            />
          </label>
        ) : (
          <span
            className="theme-token-swatch theme-token-swatch--readonly"
            style={{ background: simple ? value : "var(--border)" }}
            aria-hidden="true"
          />
        )}
        <input
          type="text"
          className="theme-token-text"
          value={value}
          onChange={(e) => onChange(tokenKey, e.target.value)}
          spellCheck={false}
        />
      </div>
    </div>
  );
}

export default function ThemeEditor({
  themeRef,
  initialName = "",
  initialTokens,
  basePresetId,
  onSave,
  onCancel,
  livePreview = true,
}) {
  const t = useT();
  const [name, setName] = useState(initialName);
  const [tokens, setTokens] = useState(() => ({ ...initialTokens }));
  const [error, setError] = useState("");

  useEffect(() => {
    setName(initialName);
    setTokens({ ...initialTokens });
    setError("");
  }, [themeRef, initialName, initialTokens]);

  const themeActiveSlot = useEditorStore((s) => s.themeActiveSlot);
  const applyActiveTheme = useEditorStore((s) => s.applyActiveTheme);

  useEffect(() => {
    if (!livePreview || !tokens) return;
    applyThemeTokens(tokens, themeActiveSlot);
  }, [tokens, livePreview, themeActiveSlot]);

  useEffect(() => {
    if (!livePreview) return;
    return () => {
      applyActiveTheme();
    };
  }, [livePreview, applyActiveTheme]);

  const updateToken = useCallback((key, value) => {
    setTokens((prev) => ({ ...prev, [key]: value }));
    setError("");
  }, []);

  const handleReset = () => {
    const base = getPresetById(basePresetId);
    if (base?.tokens) setTokens({ ...base.tokens });
  };

  const handleSave = async () => {
    const validation = validateThemeTokens(tokens);
    if (!validation.ok) {
      setError(validation.error);
      return;
    }
    if (!name.trim()) {
      setError(t("settings.appearance.editor.nameRequired"));
      return;
    }
    await onSave?.({ name: name.trim(), tokens });
  };

  return (
    <div className="theme-editor">
      <header className="theme-editor-header">
        <div className="theme-editor-header-main">
          <div>
            <h3 className="theme-editor-title">{t("settings.appearance.editor.title")}</h3>
            <p className="theme-editor-sub">{t("settings.appearance.editor.subtitle")}</p>
          </div>
          <div className="theme-editor-header-actions">
            <button type="button" className="theme-editor-link-btn" onClick={handleReset}>
              <RotateCcw size={12} />
              {t("settings.appearance.editor.reset")}
            </button>
            <button type="button" className="theme-editor-link-btn" onClick={onCancel}>
              <X size={12} />
              {t("common.cancel")}
            </button>
            <button type="button" className="cap-btn-primary theme-editor-save" onClick={handleSave}>
              <Save size={12} />
              {t("settings.appearance.editor.save")}
            </button>
          </div>
        </div>

        <label className="theme-editor-name">
          <span>{t("settings.appearance.editor.name")}</span>
          <input
            type="text"
            className="theme-editor-name-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("settings.appearance.editor.namePlaceholder")}
          />
        </label>
      </header>

      <div className="theme-editor-layout">
        <div className="theme-editor-fields">
          {TOKEN_GROUPS.map((group) => (
            <section key={group.id} className="theme-editor-group">
              <h4 className="theme-editor-group-title">{t(group.labelKey)}</h4>
              <div className={`theme-token-list${group.wide ? " theme-token-list--wide" : ""}`}>
                {group.keys.map((key) => (
                  <TokenField
                    key={key}
                    tokenKey={key}
                    value={tokens[key] || ""}
                    onChange={updateToken}
                    t={t}
                  />
                ))}
              </div>
            </section>
          ))}

          {error && <p className="theme-editor-error">{error}</p>}
        </div>

        <aside className="theme-editor-preview-panel">
          <p className="theme-editor-preview-label">{t("settings.appearance.editor.preview")}</p>
          <ThemePreviewCard tokens={tokens} className="theme-editor-preview-ui" />
          <div className="theme-editor-palette" aria-hidden="true">
            {PREVIEW_SWATCH_KEYS.map((key) => (
              <span
                key={key}
                className="theme-editor-palette-swatch"
                style={{ background: tokens[key] }}
                title={t(TOKEN_LABEL_KEYS[key])}
              />
            ))}
          </div>
          <div
            className="theme-editor-sample"
            style={{
              background: tokens.bgElevated,
              borderColor: tokens.border,
            }}
          >
            <span style={{ color: tokens.textPrimary }}>
              {name.trim() || t("settings.appearance.editor.name")}
            </span>
            <span style={{ color: tokens.textSecondary }}>
              {t("settings.appearance.editor.sampleText")}
            </span>
            <button
              type="button"
              className="theme-editor-sample-btn"
              style={{ background: tokens.accentBrand, color: tokens.bgApp }}
            >
              {t("settings.appearance.editor.sampleButton")}
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
