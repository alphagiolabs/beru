import { Bold, Italic, AlignLeft, AlignCenter, AlignRight, Ban } from "lucide-react";
import { shallow } from "zustand/shallow";
import useEditorStore from "../stores/useEditorStore";
import { pickTextStyle, patchToGlobalState } from "../utils/text-style";
import { normalizeColor } from "../utils/color-utils";
import { FONT_FAMILIES, FONT_WEIGHTS, TEXT_ALIGNS, TEXT_STYLE_PRESETS } from "../utils/types";
import TextLayoutControls from "./TextLayoutControls";
import { presetMatches, presetPreviewTextStyle } from "./style-editor/preset-utils";
import { InspectorGroup, ToggleSwitch, SegmentedToolbar, FontFamilyPicker } from "./inspector";

export default function StyleEditor() {
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
    (s) => ({
      isBatch: s.sidebarMode === "batch",
      fontFamily: s.fontFamily,
      bold: s.bold,
      italic: s.italic,
      textFontSize: s.textFontSize,
      textFontColor: s.textFontColor,
      bgEnabled: s.bgEnabled,
      bgColor: s.bgColor,
      bgOpacity: s.bgOpacity,
      borderWidth: s.borderWidth,
      borderColor: s.borderColor,
      fontWeight: s.fontWeight,
      letterSpacing: s.letterSpacing,
      textAlign: s.textAlign,
      textOpacity: s.textOpacity,
      boxBorderWidth: s.boxBorderWidth,
      textShadowEnabled: s.textShadowEnabled,
      textShadowColor: s.textShadowColor,
      textShadowOffsetX: s.textShadowOffsetX,
      textShadowOffsetY: s.textShadowOffsetY,
      autoFit: s.autoFit,
      lineHeight: s.lineHeight,
      verticalAlign: s.verticalAlign,
      textWrap: s.textWrap,
      safeMargin: s.safeMargin,
      truncate: s.truncate,
    }),
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

  return (
    <div className="space-y-2.5">
      <InspectorGroup title="Estilos" className="inspector-group--presets" collapsible defaultOpen>
        <div className="inspector-presets">
          <div
            className="inspector-preset-grid"
            role="listbox"
            aria-label="Estilos preestablecidos"
          >
            {TEXT_STYLE_PRESETS.map((preset) => {
              const active = presetMatches(preset, currentTextStyle);
              return (
                <button
                  key={preset.id || preset.name}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => patch(pickTextStyle(preset))}
                  className={`inspector-preset${active ? " is-selected" : ""}`}
                  style={{ background: preset.previewBg || "var(--bg-elevated)" }}
                  aria-label={`Aplicar estilo: ${preset.name}`}
                  title={preset.name}
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
          {(() => {
            const activePreset = TEXT_STYLE_PRESETS.find((p) => presetMatches(p, currentTextStyle));
            return (
              <div className="inspector-preset-meta" aria-live="polite">
                <span className="inspector-preset-meta-name">
                  {activePreset?.name || "Personalizado"}
                </span>
              </div>
            );
          })()}
        </div>
      </InspectorGroup>

      <InspectorGroup title="Tipografía" className="inspector-group--type" collapsible defaultOpen>
        <div className="inspector-type">
          <FontFamilyPicker
            label="Fuente"
            ariaLabel="Fuente"
            value={fontFamily}
            options={FONT_FAMILIES}
            onChange={(next) => patch({ fontFamily: next })}
          />

          <div className="inspector-type-weight">
            <span className="inspector-paragraph-micro">Peso</span>
            <SegmentedToolbar
              ariaLabel="Peso de fuente"
              columns={FONT_WEIGHTS.length}
              value={fontWeight ?? 400}
              onChange={(value) => patch({ fontWeight: value, bold: value >= 700 })}
              options={FONT_WEIGHTS.map((w) => ({
                value: w.value,
                label: "Aa",
                title: w.label,
                ariaLabel: w.label,
                style: { fontWeight: w.value, fontFamily: fontFamily || undefined },
              }))}
            />
          </div>

          <div className="inspector-type-metrics" role="group" aria-label="Tamaño y espaciado">
            <label className="inspector-type-metric">
              <span className="inspector-type-metric-key">Tam.</span>
              <input
                type="number"
                inputMode="numeric"
                aria-label="Tamaño"
                value={textFontSize}
                onChange={(e) => patch({ fontSize: Number(e.target.value) })}
                className="inspector-type-metric-input"
                min={8}
                max={200}
              />
            </label>
            <label className="inspector-type-metric">
              <span className="inspector-type-metric-key">Esp.</span>
              <input
                type="number"
                inputMode="decimal"
                aria-label="Espaciado"
                value={letterSpacing ?? 0}
                onChange={(e) => patch({ letterSpacing: Number(e.target.value) })}
                className="inspector-type-metric-input"
                step={0.5}
              />
            </label>
          </div>

          <div className="inspector-type-style" role="group" aria-label="Estilo de fuente">
            <button
              type="button"
              onClick={() => patch({ bold: !bold })}
              className={`inspector-chip${bold ? " is-selected" : ""}`}
              aria-pressed={bold}
              aria-label="Negrita"
              title="Negrita"
            >
              <Bold size={12} strokeWidth={2.5} />
              <span>Negrita</span>
            </button>
            <button
              type="button"
              onClick={() => patch({ italic: !italic })}
              className={`inspector-chip${italic ? " is-selected" : ""}`}
              aria-pressed={italic}
              aria-label="Cursiva"
              title="Cursiva"
            >
              <Italic size={12} />
              <span>Cursiva</span>
            </button>
          </div>
        </div>
      </InspectorGroup>

      <InspectorGroup
        title="Párrafo"
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
            title: a.value,
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

      <InspectorGroup title="Color" className="inspector-group--color" collapsible defaultOpen>
        <div className="inspector-color">
          <label className="inspector-color-swatch-row">
            <span className="inspector-color-key">Tinta</span>
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
                aria-label="Color de texto"
              />
            </span>
            <input
              type="text"
              value={textFontColor}
              onChange={(e) => patch({ fontColor: e.target.value })}
              className="inspector-color-hex"
              spellCheck={false}
              autoComplete="off"
              aria-label="Valor de color"
            />
          </label>

          <label className="inspector-color-opacity-row">
            <span className="inspector-color-key">Opacidad</span>
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
              aria-label="Opacidad de texto"
            />
            <span className="inspector-color-pct">{Math.round((textOpacity ?? 1) * 100)}%</span>
          </label>
        </div>
      </InspectorGroup>

      <InspectorGroup
        title="Fondo"
        className="inspector-group--fx"
        collapsible
        defaultOpen={!!bgEnabled}
        forceOpen={!!bgEnabled}
        collapseWhenOff
        hideChevron
        headerAccessory={
          <ToggleSwitch
            ariaLabel="Fondo activo"
            checked={!!bgEnabled}
            onChange={(next) => patch({ bgEnabled: next })}
          />
        }
      >
        {bgEnabled ? (
          <div className="inspector-color">
            <label className="inspector-color-swatch-row">
              <span className="inspector-color-key">Color</span>
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
                  aria-label="Color de fondo"
                />
              </span>
              <input
                type="text"
                value={bgColor}
                onChange={(e) => patch({ bgColor: e.target.value })}
                className="inspector-color-hex"
                spellCheck={false}
                autoComplete="off"
                aria-label="Valor de color de fondo"
              />
            </label>
            <label className="inspector-color-opacity-row">
              <span className="inspector-color-key">Opacidad</span>
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
                aria-label="Opacidad de fondo"
              />
              <span className="inspector-color-pct">{Math.round((bgOpacity ?? 0) * 100)}%</span>
            </label>
            <label className="inspector-color-metric-row">
              <span className="inspector-color-key">Padding</span>
              <input
                type="number"
                inputMode="numeric"
                value={boxBorderWidth ?? 4}
                onChange={(e) => patch({ boxBorderWidth: Number(e.target.value) })}
                className="inspector-color-metric-input"
                min={0}
                max={80}
                aria-label="Padding de fondo"
              />
            </label>
          </div>
        ) : null}
      </InspectorGroup>

      <InspectorGroup
        title="Contorno"
        className="inspector-group--fx"
        collapsible
        defaultOpen={strokeActive}
        forceOpen={strokeActive}
      >
        <div className="inspector-color">
          <label className="inspector-color-metric-row">
            <span className="inspector-color-key">Ancho</span>
            <input
              type="number"
              inputMode="numeric"
              value={borderWidth}
              onChange={(e) => patch({ borderWidth: Number(e.target.value) })}
              className="inspector-color-metric-input"
              min={0}
              max={20}
              aria-label="Ancho de contorno"
            />
          </label>
          <label className="inspector-color-swatch-row">
            <span className="inspector-color-key">Color</span>
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
                aria-label="Color de contorno"
              />
            </span>
            <input
              type="text"
              value={borderColor}
              onChange={(e) => patch({ borderColor: e.target.value })}
              className="inspector-color-hex"
              spellCheck={false}
              autoComplete="off"
              aria-label="Valor de color de contorno"
            />
          </label>
        </div>
      </InspectorGroup>

      <InspectorGroup
        title="Sombra"
        className="inspector-group--fx"
        collapsible
        defaultOpen={!!textShadowEnabled}
        forceOpen={!!textShadowEnabled}
        collapseWhenOff
        hideChevron
        headerAccessory={
          <ToggleSwitch
            ariaLabel="Sombra activa"
            checked={!!textShadowEnabled}
            onChange={(next) => patch({ textShadowEnabled: next })}
          />
        }
      >
        {textShadowEnabled ? (
          <div className="inspector-color">
            <label className="inspector-color-swatch-row">
              <span className="inspector-color-key">Color</span>
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
                  aria-label="Color de sombra"
                />
              </span>
              <input
                type="text"
                value={textShadowColor}
                onChange={(e) => patch({ textShadowColor: e.target.value })}
                className="inspector-color-hex"
                spellCheck={false}
                autoComplete="off"
                aria-label="Valor de color de sombra"
              />
            </label>
            <div className="inspector-color-pair" role="group" aria-label="Offset de sombra">
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
                  aria-label="Offset X de sombra"
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
                  aria-label="Offset Y de sombra"
                />
              </label>
            </div>
          </div>
        ) : null}
      </InspectorGroup>
    </div>
  );
}
