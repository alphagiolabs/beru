import { Bold, Italic, AlignLeft, AlignCenter, AlignRight, ScanEye, Ban } from "lucide-react";
import { shallow } from "zustand/shallow";
import useEditorStore from "../stores/useEditorStore";
import { pickTextStyle } from "../utils/text-style";
import { normalizeColor } from "../utils/color-utils";
import { FONT_FAMILIES, FONT_WEIGHTS, TEXT_ALIGNS, TEXT_STYLE_PRESETS } from "../utils/types";
import TextLayoutControls from "./TextLayoutControls";
import { presetMatches, presetPreviewTextStyle } from "./style-editor/preset-utils";
import { InspectorGroup, ToggleSwitch, SegmentedToolbar } from "./inspector";

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
      if (stylePatch.fontSize != null) getState().setTextFontSize(stylePatch.fontSize);
      if (stylePatch.fontColor != null) getState().setTextFontColor(stylePatch.fontColor);
      if (stylePatch.fontFamily != null) getState().setFontFamily(stylePatch.fontFamily);
      if (stylePatch.fontWeight != null) getState().setFontWeight(stylePatch.fontWeight);
      if (stylePatch.letterSpacing != null) getState().setLetterSpacing(stylePatch.letterSpacing);
      if (stylePatch.textAlign != null) getState().setTextAlign(stylePatch.textAlign);
      if (stylePatch.textOpacity != null) getState().setTextOpacity(stylePatch.textOpacity);
      if (stylePatch.bold != null) getState().setBold(stylePatch.bold);
      if (stylePatch.italic != null) getState().setItalic(stylePatch.italic);
      if (stylePatch.bgEnabled != null) getState().setBgEnabled(stylePatch.bgEnabled);
      if (stylePatch.bgColor != null) getState().setBgColor(stylePatch.bgColor);
      if (stylePatch.bgOpacity != null) getState().setBgOpacity(stylePatch.bgOpacity);
      if (stylePatch.boxBorderWidth != null)
        getState().setBoxBorderWidth(stylePatch.boxBorderWidth);
      if (stylePatch.borderWidth != null) getState().setBorderWidth(stylePatch.borderWidth);
      if (stylePatch.borderColor != null) getState().setBorderColor(stylePatch.borderColor);
      if (stylePatch.textShadowEnabled != null) {
        getState().setTextShadowEnabled(stylePatch.textShadowEnabled);
      }
      if (stylePatch.textShadowColor != null)
        getState().setTextShadowColor(stylePatch.textShadowColor);
      if (stylePatch.textShadowOffsetX != null) {
        getState().setTextShadowOffsetX(stylePatch.textShadowOffsetX);
      }
      if (stylePatch.textShadowOffsetY != null) {
        getState().setTextShadowOffsetY(stylePatch.textShadowOffsetY);
      }
      if (stylePatch.autoFit != null) getState().setAutoFit(stylePatch.autoFit);
      if (stylePatch.lineHeight != null) getState().setLineHeight(stylePatch.lineHeight);
      if (stylePatch.verticalAlign != null) getState().setVerticalAlign(stylePatch.verticalAlign);
      if (stylePatch.textWrap != null) getState().setTextWrap(stylePatch.textWrap);
      if (stylePatch.safeMargin != null) getState().setSafeMargin(stylePatch.safeMargin);
      if (stylePatch.truncate != null) getState().setTruncate(stylePatch.truncate);
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
      <InspectorGroup title="Vista previa">
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent("beru:preview:renderFrame"))}
          className="cap-btn-secondary w-full !text-[11px]"
          title="Genera un frame con FFmpeg drawtext en el tiempo actual del reproductor"
        >
          <ScanEye size={13} style={{ color: "var(--accent-brand)" }} />
          Previsualizar frame renderizado
        </button>
      </InspectorGroup>

      <InspectorGroup title="Estilo preestablecido">
        <div className="inspector-preset-grid">
          {TEXT_STYLE_PRESETS.map((preset) => {
            const active = presetMatches(preset, currentTextStyle);
            return (
              <button
                key={preset.id || preset.name}
                type="button"
                onClick={() => patch(pickTextStyle(preset))}
                className={`inspector-preset${active ? " is-selected" : ""}`}
                style={{ background: preset.previewBg || "var(--bg-surface)" }}
                aria-label={`Aplicar estilo: ${preset.name}`}
                title={preset.name}
                data-text-style-preset
                data-preset-id={preset.id}
              >
                {preset.id === "plain" ? (
                  <Ban size={16} style={{ color: "var(--text-dim)" }} />
                ) : (
                  <span style={presetPreviewTextStyle(preset)}>Aa</span>
                )}
              </button>
            );
          })}
        </div>
      </InspectorGroup>

      <InspectorGroup title="Tipografía">
        <label>
          <span className="cap-input-label">Fuente</span>
          <select
            value={fontFamily}
            onChange={(e) => patch({ fontFamily: e.target.value })}
            className="cap-input text-[11px]"
          >
            {FONT_FAMILIES.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>

        <div>
          <span className="cap-input-label">Peso</span>
          <SegmentedToolbar
            ariaLabel="Peso de fuente"
            columns={7}
            value={fontWeight ?? 400}
            onChange={(value) => patch({ fontWeight: value, bold: value >= 700 })}
            options={FONT_WEIGHTS.map((w) => ({
              value: w.value,
              label: "Aa",
              title: w.label,
              style: { fontWeight: w.value },
            }))}
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label>
            <span className="cap-input-label">Tamaño</span>
            <input
              type="number"
              value={textFontSize}
              onChange={(e) => patch({ fontSize: Number(e.target.value) })}
              className="cap-input font-mono text-[11px]"
              min={8}
              max={200}
            />
          </label>
          <label>
            <span className="cap-input-label">Espaciado</span>
            <input
              type="number"
              value={letterSpacing ?? 0}
              onChange={(e) => patch({ letterSpacing: Number(e.target.value) })}
              className="cap-input font-mono text-[11px]"
              step={0.5}
            />
          </label>
        </div>

        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => patch({ bold: !bold })}
            className={`inspector-chip flex-1 gap-1${bold ? " is-selected" : ""}`}
            aria-pressed={bold}
          >
            <Bold size={12} /> Negrita
          </button>
          <button
            type="button"
            onClick={() => patch({ italic: !italic })}
            className={`inspector-chip flex-1 gap-1${italic ? " is-selected" : ""}`}
            aria-pressed={italic}
          >
            <Italic size={12} /> Cursiva
          </button>
        </div>
      </InspectorGroup>

      <InspectorGroup title="Párrafo">
        <div>
          <span className="cap-input-label">Alineación</span>
          <SegmentedToolbar
            ariaLabel="Alineación horizontal"
            columns={3}
            value={textAlign || "left"}
            onChange={(value) => patch({ textAlign: value })}
            options={TEXT_ALIGNS.map((a) => ({
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
        </div>
        <TextLayoutControls
          values={{ autoFit, lineHeight, verticalAlign, textWrap, safeMargin, truncate }}
          onPatch={patch}
        />
      </InspectorGroup>

      <InspectorGroup title="Color">
        <label className="min-w-0 block">
          <span className="cap-input-label">Color</span>
          <div className="flex gap-1.5 min-w-0">
            <input
              type="color"
              value={normalizeColor(textFontColor) || "#ffffff"}
              onChange={(e) => patch({ fontColor: e.target.value })}
              className="w-7 h-7 shrink-0 rounded border-0 p-0 cursor-pointer"
            />
            <input
              type="text"
              value={textFontColor}
              onChange={(e) => patch({ fontColor: e.target.value })}
              className="cap-input min-w-0 flex-1 font-mono text-[10px]"
            />
          </div>
        </label>
        <label className="min-w-0 block">
          <span className="cap-input-label">Opacidad</span>
          <div className="flex items-center gap-2 min-w-0">
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={textOpacity ?? 1}
              onChange={(e) => patch({ textOpacity: parseFloat(e.target.value) })}
              className="inspector-range"
              style={{ accentColor: "var(--accent-brand)" }}
            />
            <span
              className="font-mono text-[10px] w-8 shrink-0 text-right"
              style={{ color: "var(--text-dim)" }}
            >
              {Math.round((textOpacity ?? 1) * 100)}%
            </span>
          </div>
        </label>
      </InspectorGroup>

      <InspectorGroup title="Fondo" collapsible defaultOpen={!!bgEnabled} forceOpen={!!bgEnabled}>
        <ToggleSwitch
          label="Activo"
          checked={!!bgEnabled}
          onChange={(next) => patch({ bgEnabled: next })}
        />
        {bgEnabled && (
          <div className="space-y-1.5">
            <div className="grid grid-cols-2 gap-2">
              <label>
                <span className="cap-input-label">Color</span>
                <div className="flex gap-1">
                  <input
                    type="color"
                    value={normalizeColor(bgColor) || "#000000"}
                    onChange={(e) => patch({ bgColor: e.target.value })}
                    className="w-6 h-6 rounded border-0 p-0 cursor-pointer"
                  />
                  <input
                    type="text"
                    value={bgColor}
                    onChange={(e) => patch({ bgColor: e.target.value })}
                    className="cap-input flex-1 font-mono text-[10px]"
                  />
                </div>
              </label>
              <label>
                <span className="cap-input-label">Opacidad</span>
                <input
                  type="number"
                  value={bgOpacity}
                  onChange={(e) => patch({ bgOpacity: parseFloat(e.target.value) })}
                  className="cap-input font-mono text-[11px]"
                  min={0}
                  max={1}
                  step={0.05}
                />
              </label>
            </div>
            <label>
              <span className="cap-input-label">Padding</span>
              <input
                type="number"
                value={boxBorderWidth ?? 4}
                onChange={(e) => patch({ boxBorderWidth: Number(e.target.value) })}
                className="cap-input font-mono text-[11px]"
                min={0}
                max={80}
              />
            </label>
          </div>
        )}
      </InspectorGroup>

      <InspectorGroup
        title="Contorno"
        collapsible
        defaultOpen={strokeActive}
        forceOpen={strokeActive}
      >
        <div className="grid grid-cols-2 gap-2">
          <label>
            <span className="cap-input-label">Ancho</span>
            <input
              type="number"
              value={borderWidth}
              onChange={(e) => patch({ borderWidth: Number(e.target.value) })}
              className="cap-input font-mono text-[11px]"
              min={0}
              max={20}
            />
          </label>
          <label>
            <span className="cap-input-label">Color</span>
            <div className="flex gap-1">
              <input
                type="color"
                value={normalizeColor(borderColor) || "#000000"}
                onChange={(e) => patch({ borderColor: e.target.value })}
                className="w-6 h-6 rounded border-0 p-0 cursor-pointer"
              />
              <input
                type="text"
                value={borderColor}
                onChange={(e) => patch({ borderColor: e.target.value })}
                className="cap-input flex-1 font-mono text-[10px]"
              />
            </div>
          </label>
        </div>
      </InspectorGroup>

      <InspectorGroup
        title="Sombra"
        collapsible
        defaultOpen={!!textShadowEnabled}
        forceOpen={!!textShadowEnabled}
      >
        <ToggleSwitch
          label="Activa"
          checked={!!textShadowEnabled}
          onChange={(next) => patch({ textShadowEnabled: next })}
        />
        {textShadowEnabled && (
          <div className="space-y-1.5">
            <label>
              <span className="cap-input-label">Color</span>
              <div className="flex gap-1">
                <input
                  type="color"
                  value={normalizeColor(textShadowColor) || "#000000"}
                  onChange={(e) => patch({ textShadowColor: e.target.value })}
                  className="w-6 h-6 rounded border-0 p-0 cursor-pointer"
                />
                <input
                  type="text"
                  value={textShadowColor}
                  onChange={(e) => patch({ textShadowColor: e.target.value })}
                  className="cap-input flex-1 font-mono text-[10px]"
                />
              </div>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label>
                <span className="cap-input-label">Offset X</span>
                <input
                  type="number"
                  value={textShadowOffsetX ?? 2}
                  onChange={(e) => patch({ textShadowOffsetX: Number(e.target.value) })}
                  className="cap-input font-mono text-[11px]"
                  min={-64}
                  max={64}
                />
              </label>
              <label>
                <span className="cap-input-label">Offset Y</span>
                <input
                  type="number"
                  value={textShadowOffsetY ?? 2}
                  onChange={(e) => patch({ textShadowOffsetY: Number(e.target.value) })}
                  className="cap-input font-mono text-[11px]"
                  min={-64}
                  max={64}
                />
              </label>
            </div>
          </div>
        )}
      </InspectorGroup>
    </div>
  );
}
