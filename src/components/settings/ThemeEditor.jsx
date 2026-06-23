import { useCallback, useEffect, useState } from "react";
import { RotateCcw, Save, X } from "lucide-react";
import { useT } from "../../i18n/useT";
import useEditorStore from "../../stores/useEditorStore";
import { applyThemeTokens, validateThemeTokens } from "../../theme/engine.js";
import { THEME_TOKEN_KEYS, TOKEN_LABEL_KEYS } from "../../theme/tokens.js";
import { getPresetById } from "../../theme/presets.js";
import ThemePreviewCard from "./ThemePreviewCard.jsx";

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
      <div className="theme-editor-header">
        <div>
          <h3 className="theme-editor-title">{t("settings.appearance.editor.title")}</h3>
          <p className="theme-editor-sub">{t("settings.appearance.editor.subtitle")}</p>
        </div>
        <div className="theme-editor-header-actions">
          <button type="button" className="cap-btn-secondary" onClick={handleReset}>
            <RotateCcw size={12} />
            {t("settings.appearance.editor.reset")}
          </button>
          <button type="button" className="cap-btn-secondary" onClick={onCancel}>
            <X size={12} />
            {t("common.cancel")}
          </button>
          <button type="button" className="cap-btn-primary" onClick={handleSave}>
            <Save size={12} />
            {t("settings.appearance.editor.save")}
          </button>
        </div>
      </div>

      <div className="theme-editor-layout">
        <div className="theme-editor-fields">
          <label className="theme-editor-name-label">
            <span>{t("settings.appearance.editor.name")}</span>
            <input
              type="text"
              className="cap-input w-full"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("settings.appearance.editor.namePlaceholder")}
            />
          </label>

          <div className="theme-token-list">
            {THEME_TOKEN_KEYS.map((key) => {
              const val = tokens[key] || "";
              const simple = isSimpleColor(val);
              return (
                <div key={key} className="theme-token-row">
                  <span className="theme-token-label">{t(TOKEN_LABEL_KEYS[key])}</span>
                  <div className="theme-token-inputs">
                    {simple && key !== "modalShadow" && (
                      <input
                        type="color"
                        className="theme-token-color"
                        value={hexToColorInput(val)}
                        onChange={(e) => updateToken(key, e.target.value)}
                        aria-label={t(TOKEN_LABEL_KEYS[key])}
                      />
                    )}
                    <input
                      type="text"
                      className="cap-input theme-token-text"
                      value={val}
                      onChange={(e) => updateToken(key, e.target.value)}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {error && <p className="theme-editor-error">{error}</p>}
        </div>

        <div className="theme-editor-preview-panel">
          <span className="theme-editor-preview-label">
            {t("settings.appearance.editor.preview")}
          </span>
          <ThemePreviewCard tokens={tokens} />
          <div
            className="theme-editor-sample-modal"
            style={{
              background: tokens.bgElevated,
              borderColor: tokens.border,
              boxShadow: tokens.modalShadow,
            }}
          >
            <span style={{ color: tokens.textPrimary }}>{t("settings.title")}</span>
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
        </div>
      </div>
    </div>
  );
}
