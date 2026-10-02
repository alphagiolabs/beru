import { Bold, Italic, AlignLeft, AlignCenter, AlignRight, Ban } from "lucide-react";
import { shallow } from "zustand/shallow";
import useEditorStore from "../stores/useEditorStore";
import { pickTextStyle, pickGlobalTextStyle, patchToGlobalState } from "../utils/text-style";
import { normalizeColor } from "../utils/color-utils";
import { FONT_FAMILIES, FONT_WEIGHTS, TEXT_ALIGNS, TEXT_STYLE_PRESETS } from "../utils/types";
import TextLayoutControls from "./TextLayoutControls";
import { useT } from "../i18n/useT";
import { presetMatches, presetPreviewTextStyle } from "./style-editor/preset-utils";
import { InspectorGroup, ToggleSwitch, SegmentedToolbar, FontFamilyPicker } from "./inspector";

export default function StyleEditor() {
  const t = useT();
  const {
    isBatch,
    fontFamily,
    bold,
    italic,
    textFontSize,
    textFontColor,
    bgEnabled,
    bgColor,
    bgOpacity,
    borderWidth,
    borderColor,
    fontWeight,
    letterSpacing,
    textAlign,
    textOpacity,
    boxBorderWidth,
    textShadowEnabled,
    textShadowColor,
    textShadowOffsetX,
    textShadowOffsetY,
    autoFit,
    lineHeight,
    verticalAlign,
    textWrap,
    safeMargin,
    truncate,
  } = useEditorStore(
    (s) => ({ isBatch: s.sidebarMode === "batch", ...pickGlobalTextStyle(s) }),
    shallow,
  );

  const patch = (stylePatch) => {
    const getState = useEditorStore.getState;
    if (isBatch) getState().patchBatchTextStyle(stylePatch);
    else {
      useEditorStore.setState(patchToGlobalState(stylePatch));
    }
  };

  const currentTextStyle = {
    fontFamily,
    fontColor: textFontColor,
    fontWeight,
    letterSpacing,
    textOpacity,
    bold,
    italic,
    bgEnabled,
    bgColor,
    bgOpacity,
    boxBorderWidth,
    borderWidth,
    borderColor,
    textShadowEnabled,
    textShadowColor,
    textShadowOffsetX,
    textShadowOffsetY,
  };

  const strokeActive = (borderWidth ?? 0) > 0;
  const activePreset = TEXT_STYLE_PRESETS.find((p) => presetMatches(p, currentTextStyle));

  return (
    <div className="space-y-2.5">
      <InspectorGroup
        title={
          <>
            {t("props.styles")}
            <span className="inspector-preset-meta-name" aria-live="polite">
              {activePreset ? t(activePreset.nameKey) : t("props.customStyle")}
            </span>
          </>
        }
        className="inspector-group--presets"
        collapsible
        defaultOpen
      >
        <div className="inspector-presets">
          <div
            className="inspector-preset-grid"
            role="listbox"
            aria-label={t("props.presetStyles")}
          >
            {TEXT_STYLE_PRESETS.map((preset) => {
              const active = presetMatches(preset, currentTextStyle);
              return (
                <button
                  key={preset.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => patch(pickTextStyle(preset))}
                  className={`inspector-preset${active ? " is-selected" : ""}`}
                  style={{ background: preset.previewBg || "var(--bg-elevated)" }}
                  aria-label={t("props.applyStyle", { name: t(preset.nameKey) })}
                  title={t(preset.nameKey)}
                  data-text-style-preset
                  data-preset-id={preset.id}
                >
                  {preset.id === "plain" ? (
                    <Ban size={13} className="inspector-preset-plain" aria-hidden />
                  ) : (
                    <span
                      className="inspector-preset-sample"
                      style={presetPreviewTextStyle(preset)}
                    >
                      Aa
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </InspectorGroup>

      <InspectorGroup
        title={t("props.typography")}
        className="inspector-group--type"
        collapsible
        defaultOpen
      >
        <div className="inspector-type">
          <FontFamilyPicker
            label={t("table.font")}
            ariaLabel={t("table.font")}
            value={fontFamily}
            options={FONT_FAMILIES}
            onChange={(next) => patch({ fontFamily: next })}
          />

          <div className="inspector-type-weight">
            <span className="inspector-paragraph-micro">{t("table.weight")}</span>
            <SegmentedToolbar
              ariaLabel={t("props.fontWeight")}
              columns={FONT_WEIGHTS.length}
              value={fontWeight ?? 400}
              onChange={(value) => patch({ fontWeight: value, bold: value >= 700 })}
              options={FONT_WEIGHTS.map((w) => ({
                value: w.value,
                label: String(w.value),
                title: t(w.labelKey),
                ariaLabel: t(w.labelKey),
                style: { fontWeight: w.value, fontFamily: fontFamily || undefined },
              }))}
            />
          </div>

          <div className="inspector-type-row">
            <div
              className="inspector-type-metrics"
              role="group"
              aria-label={t("props.sizeAndTracking")}
            >
              <label className="inspector-type-metric">
                <span className="inspector-type-metric-key">{t("props.sizeAbbr")}</span>
                <input
                  type="number"
                  inputMode="numeric"
                  aria-label={t("table.size")}
                  value={textFontSize}
                  onChange={(e) => patch({ fontSize: Number(e.target.value) })}
                  className="inspector-type-metric-input"
                  min={8}
                  max={200}
                />
              </label>
              <label className="inspector-type-metric">
                <span className="inspector-type-metric-key">{t("props.trackingAbbr")}</span>
                <input
                  type="number"
                  inputMode="decimal"
                  aria-label={t("table.tracking")}
                  value={letterSpacing ?? 0}
                  onChange={(e) => patch({ letterSpacing: Number(e.target.value) })}
                  className="inspector-type-metric-input"
                  min={-20}
                  max={80}
                  step={0.5}
                />
              </label>
            </div>

            <div className="inspector-type-style" role="group" aria-label={t("props.fontStyle")}>
              <button
                type="button"
                onClick={() => patch({ bold: !bold })}
                className={`inspector-chip${bold ? " is-selected" : ""}`}
                aria-pressed={bold}
                aria-label={t("props.bold")}
                title={t("props.bold")}
              >
                <Bold size={12} strokeWidth={2.5} />
              </button>
              <button
                type="button"
                onClick={() => patch({ italic: !italic })}
                className={`inspector-chip${italic ? " is-selected" : ""}`}
                aria-pressed={italic}
                aria-label={t("props.italic")}
                title={t("props.italic")}
              >
                <Italic size={12} />
              </button>
            </div>
          </div>
        </div>
      </InspectorGroup>

      <InspectorGroup
        title={t("props.paragraph")}
        className="inspector-group--paragraph"
        collapsible
        defaultOpen
      >
        <TextLayoutControls
          showTextAlign
          values={{
            textAlign: textAlign || "left",
            autoFit,
            lineHeight,
            verticalAlign,
            textWrap,
            safeMargin,
            truncate,
          }}
          onPatch={patch}
          textAlignOptions={TEXT_ALIGNS.map((a) => ({
            value: a.value,
            title: t(`position.${a.value}`),
            icon:
              a.value === "left" ? (
                <AlignLeft size={12} />
              ) : a.value === "center" ? (
                <AlignCenter size={12} />
              ) : (
                <AlignRight size={12} />
              ),
          }))}
        />
      </InspectorGroup>

      <InspectorGroup
        title={t("table.color")}
        className="inspector-group--color"
        collapsible
        defaultOpen
      >
        <div className="inspector-color">
          <label className="inspector-color-swatch-row">
            <span className="inspector-color-key">{t("props.ink")}</span>
            <span className="inspector-color-swatch">
              <span
                className="inspector-color-swatch-fill"
                style={{
                  background: normalizeColor(textFontColor) || textFontColor || "#ffffff",
                  opacity: textOpacity ?? 1,
                }}
                aria-hidden
              />
              <input
                type="color"
                value={normalizeColor(textFontColor) || "#ffffff"}
                onChange={(e) => patch({ fontColor: e.target.value })}
                className="inspector-color-swatch-input"
                aria-label={t("props.textColor")}
              />
            </span>
            <input
              type="text"
              value={textFontColor}
              onChange={(e) => patch({ fontColor: e.target.value })}
              className="inspector-color-hex"
              spellCheck={false}
              autoComplete="off"
              aria-label={t("props.textColorValue")}
            />
          </label>

          <label className="inspector-color-opacity-row">
            <span className="inspector-color-key">{t("table.opacity")}</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={textOpacity ?? 1}
              onChange={(e) => patch({ textOpacity: parseFloat(e.target.value) })}
              className="inspector-color-range"
              style={{
                accentColor: normalizeColor(textFontColor) || "var(--accent-brand)",
              }}
              aria-label={t("props.textOpacity")}
            />
            <span className="inspector-color-pct">{Math.round((textOpacity ?? 1) * 100)}%</span>
          </label>
        </div>
      </InspectorGroup>

      <InspectorGroup
        title={t("table.background")}
        className="inspector-group--fx"
        collapsible
        defaultOpen={!!bgEnabled}
        forceOpen={!!bgEnabled}
        collapseWhenOff
        hideChevron
        headerAccessory={
          <ToggleSwitch
            ariaLabel={t("props.backgroundActive")}
            checked={!!bgEnabled}
            onChange={(next) => patch({ bgEnabled: next })}
          />
        }
      >
        {bgEnabled ? (
          <div className="inspector-color">
            <label className="inspector-color-swatch-row">
              <span className="inspector-color-key">{t("table.color")}</span>
              <span className="inspector-color-swatch">
                <span
                  className="inspector-color-swatch-fill"
                  style={{
                    background: normalizeColor(bgColor) || bgColor || "#000000",
                    opacity: bgOpacity ?? 1,
                  }}
                  aria-hidden
                />
                <input
                  type="color"
                  value={normalizeColor(bgColor) || "#000000"}
                  onChange={(e) => patch({ bgColor: e.target.value })}
                  className="inspector-color-swatch-input"
                  aria-label={t("props.backgroundColor")}
                />
              </span>
              <input
                type="text"
                value={bgColor}
                onChange={(e) => patch({ bgColor: e.target.value })}
                className="inspector-color-hex"
                spellCheck={false}
                autoComplete="off"
                aria-label={t("props.backgroundColorValue")}
              />
            </label>
            <label className="inspector-color-opacity-row">
              <span className="inspector-color-key">{t("table.opacity")}</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={bgOpacity ?? 0}
                onChange={(e) => patch({ bgOpacity: parseFloat(e.target.value) })}
                className="inspector-color-range"
                style={{
                  accentColor: normalizeColor(bgColor) || "var(--accent-brand)",
                }}
                aria-label={t("props.backgroundOpacity")}
              />
              <span className="inspector-color-pct">{Math.round((bgOpacity ?? 0) * 100)}%</span>
            </label>
            <label className="inspector-color-metric-row">
              <span className="inspector-color-key">{t("props.padding")}</span>
              <input
                type="number"
                inputMode="numeric"
                value={boxBorderWidth ?? 4}
                onChange={(e) => patch({ boxBorderWidth: Number(e.target.value) })}
                className="inspector-color-metric-input"
                min={0}
                max={80}
                aria-label={t("props.backgroundPadding")}
              />
            </label>
          </div>
        ) : null}
      </InspectorGroup>

      <InspectorGroup
        title={t("table.stroke")}
        className="inspector-group--fx"
        collapsible
        defaultOpen={strokeActive}
        forceOpen={strokeActive}
      >
        <div className="inspector-color">
          <label className="inspector-color-metric-row">
            <span className="inspector-color-key">{t("props.widthAbbr")}</span>
            <input
              type="number"
              inputMode="numeric"
              value={borderWidth}
              onChange={(e) => patch({ borderWidth: Number(e.target.value) })}
              className="inspector-color-metric-input"
              min={0}
              max={20}
              aria-label={t("props.strokeWidth")}
            />
          </label>
          <label className="inspector-color-swatch-row">
            <span className="inspector-color-key">{t("table.color")}</span>
            <span className="inspector-color-swatch">
              <span
                className="inspector-color-swatch-fill"
                style={{ background: normalizeColor(borderColor) || borderColor || "#000000" }}
                aria-hidden
              />
              <input
                type="color"
                value={normalizeColor(borderColor) || "#000000"}
                onChange={(e) => patch({ borderColor: e.target.value })}
                className="inspector-color-swatch-input"
                aria-label={t("props.strokeColor")}
              />
            </span>
            <input
              type="text"
              value={borderColor}
              onChange={(e) => patch({ borderColor: e.target.value })}
              className="inspector-color-hex"
              spellCheck={false}
              autoComplete="off"
              aria-label={t("props.strokeColorValue")}
            />
          </label>
        </div>
      </InspectorGroup>

      <InspectorGroup
        title={t("table.shadow")}
        className="inspector-group--fx"
        collapsible
        defaultOpen={!!textShadowEnabled}
        forceOpen={!!textShadowEnabled}
        collapseWhenOff
        hideChevron
        headerAccessory={
          <ToggleSwitch
            ariaLabel={t("props.shadowActive")}
            checked={!!textShadowEnabled}
            onChange={(next) => patch({ textShadowEnabled: next })}
          />
        }
      >
        {textShadowEnabled ? (
          <div className="inspector-color">
            <label className="inspector-color-swatch-row">
              <span className="inspector-color-key">{t("table.color")}</span>
              <span className="inspector-color-swatch">
                <span
                  className="inspector-color-swatch-fill"
                  style={{
                    background: normalizeColor(textShadowColor) || textShadowColor || "#000000",
                  }}
                  aria-hidden
                />
                <input
                  type="color"
                  value={normalizeColor(textShadowColor) || "#000000"}
                  onChange={(e) => patch({ textShadowColor: e.target.value })}
                  className="inspector-color-swatch-input"
                  aria-label={t("props.shadowColor")}
                />
              </span>
              <input
                type="text"
                value={textShadowColor}
                onChange={(e) => patch({ textShadowColor: e.target.value })}
                className="inspector-color-hex"
                spellCheck={false}
                autoComplete="off"
                aria-label={t("props.shadowColorValue")}
              />
            </label>
            <div className="inspector-color-pair" role="group" aria-label={t("props.shadowOffset")}>
              <label className="inspector-color-pair-cell">
                <span className="inspector-color-pair-key">X</span>
                <input
                  type="number"
                  inputMode="numeric"
                  value={textShadowOffsetX ?? 2}
                  onChange={(e) => patch({ textShadowOffsetX: Number(e.target.value) })}
                  className="inspector-color-metric-input"
                  min={-64}
                  max={64}
                  aria-label={t("props.shadowOffsetX")}
                />
              </label>
              <label className="inspector-color-pair-cell">
                <span className="inspector-color-pair-key">Y</span>
                <input
                  type="number"
                  inputMode="numeric"
                  value={textShadowOffsetY ?? 2}
                  onChange={(e) => patch({ textShadowOffsetY: Number(e.target.value) })}
                  className="inspector-color-metric-input"
                  min={-64}
                  max={64}
                  aria-label={t("props.shadowOffsetY")}
                />
              </label>
            </div>
          </div>
        ) : null}
      </InspectorGroup>
    </div>
  );
}
