import { Bold, Italic, AlignLeft, AlignCenter, AlignRight, ScanEye, Ban } from "lucide-react";
import { shallow } from "zustand/shallow";
import useEditorStore from "../stores/useEditorStore";
import { pickTextStyle } from "../utils/text-style";
import { normalizeColor } from "../utils/color-utils";
import { FONT_FAMILIES, FONT_WEIGHTS, TEXT_ALIGNS, TEXT_STYLE_PRESETS } from "../utils/types";
import TextLayoutControls from "./TextLayoutControls";

function samePresetValue(a, b) {
  if (typeof a === "string" || typeof b === "string") {
    return String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase();
  }
  return a === b;
}

function presetMatches(preset, currentStyle) {
  const style = pickTextStyle(preset);
  return Object.entries(style).every(([key, value]) => samePresetValue(currentStyle[key], value));
}

function presetTextShadow(preset) {
  if (!preset.textShadowEnabled) return "none";
  const x = Math.max(-4, Math.min(4, Number(preset.textShadowOffsetX ?? 2)));
  const y = Math.max(-4, Math.min(4, Number(preset.textShadowOffsetY ?? 2)));
  return `${x}px ${y}px 0 ${preset.textShadowColor || "black"}`;
}

function presetPreviewTextStyle(preset) {
  const strokeWidth = Math.min(2, Number(preset.borderWidth ?? 0));
  return {
    color: preset.fontColor || "white",
    fontFamily: `"${preset.fontFamily || "Arial"}", sans-serif`,
    fontSize: "18px",
    fontStyle: preset.italic ? "italic" : "normal",
    fontWeight: preset.fontWeight ?? (preset.bold ? 700 : 400),
    letterSpacing: `${Math.min(1.5, Number(preset.letterSpacing ?? 0))}px`,
    lineHeight: 1,
    padding: preset.bgEnabled ? "2px 3px" : 0,
    borderRadius: "3px",
    background: preset.bgEnabled ? preset.bgColor : "transparent",
    textShadow: presetTextShadow(preset),
    WebkitTextStroke: strokeWidth > 0 ? `${strokeWidth}px ${preset.borderColor || "black"}` : "0",
  };
}

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

  return (
    <div className="space-y-2">
      <div className="pb-2 mb-1 border-b" style={{ borderColor: "var(--border)" }}>
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent("beru:preview:renderFrame"))}
          className="w-full py-1.5 px-2 rounded text-[10px] font-medium flex items-center justify-center gap-1.5 transition-colors hover:opacity-90"
          style={{
            background: "var(--bg-elevated)",
            color: "var(--text-secondary)",
            border: "1px solid var(--border)",
          }}
          title="Genera un frame con FFmpeg drawtext en el tiempo actual del reproductor"
        >
          <ScanEye size={12} style={{ color: "var(--accent)" }} />
          Previsualizar frame renderizado
        </button>
        <p className="text-[9px] mt-1 leading-snug" style={{ color: "var(--text-dim)" }}>
          Compara CSS vs FFmpeg en el reproductor (modos CSS, FFmpeg o lado a lado).
        </p>
      </div>

      <div className="pb-2 mb-1 border-b" style={{ borderColor: "var(--border)" }}>
        <span className="cap-input-label">Estilo preestablecido</span>
        <div className="grid grid-cols-7 gap-1">
          {TEXT_STYLE_PRESETS.map((preset) => {
            const active = presetMatches(preset, currentTextStyle);
            return (
              <button
                key={preset.id || preset.name}
                type="button"
                onClick={() => patch(pickTextStyle(preset))}
                className="h-8 min-w-0 rounded flex items-center justify-center transition-colors"
                style={{
                  background: preset.previewBg || "var(--bg-elevated)",
                  border: active ? "1px solid var(--accent)" : "1px solid var(--border)",
                  boxShadow: active ? "0 0 0 1px var(--accent)" : "none",
                }}
                aria-label={`Aplicar estilo: ${preset.name}`}
                title={preset.name}
                data-text-style-preset
                data-preset-id={preset.id}
              >
                {preset.id === "plain" ? (
                  <Ban size={18} style={{ color: "var(--text-dim)" }} />
                ) : (
                  <span style={presetPreviewTextStyle(preset)}>Aa</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

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
        <div className="grid grid-cols-7 gap-0.5">
          {FONT_WEIGHTS.map((w) => {
            const active = (fontWeight ?? 400) === w.value;
            return (
              <button
                key={w.value}
                onClick={() => patch({ fontWeight: w.value, bold: w.value >= 700 })}
                className="cap-btn-secondary !text-[9px] !px-0 !py-1.5"
                style={{
                  ...(active
                    ? {
                        background: "var(--accent)",
                        color: "var(--bg-app)",
                        borderColor: "var(--accent)",
                      }
                    : {}),
                  fontWeight: w.value,
                }}
                title={w.label}
              >
                Aa
              </button>
            );
          })}
        </div>
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

      <div>
        <span className="cap-input-label">Alineación</span>
        <div className="grid grid-cols-3 gap-1">
          {TEXT_ALIGNS.map((a) => {
            const active = (textAlign || "left") === a.value;
            return (
              <button
                key={a.value}
                onClick={() => patch({ textAlign: a.value })}
                className="cap-btn-secondary !text-[10px] !py-1"
                style={
                  active
                    ? {
                        background: "var(--accent)",
                        color: "var(--bg-app)",
                        borderColor: "var(--accent)",
                      }
                    : {}
                }
              >
                {a.value === "left" && <AlignLeft size={12} />}
                {a.value === "center" && <AlignCenter size={12} />}
                {a.value === "right" && <AlignRight size={12} />}
              </button>
            );
          })}
        </div>
      </div>

      <TextLayoutControls
        values={{ autoFit, lineHeight, verticalAlign, textWrap, safeMargin, truncate }}
        onPatch={patch}
      />

      <div className="grid grid-cols-2 gap-2">
        <label>
          <span className="cap-input-label">Color</span>
          <div className="flex gap-1">
            <input
              type="color"
              value={normalizeColor(textFontColor) || "#ffffff"}
              onChange={(e) => patch({ fontColor: e.target.value })}
              className="w-7 h-7 rounded border-0 p-0 cursor-pointer"
            />
            <input
              type="text"
              value={textFontColor}
              onChange={(e) => patch({ fontColor: e.target.value })}
              className="cap-input flex-1 font-mono text-[10px]"
            />
          </div>
        </label>
        <label>
          <span className="cap-input-label">Opacidad</span>
          <div className="flex items-center gap-1.5">
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={textOpacity ?? 1}
              onChange={(e) => patch({ textOpacity: parseFloat(e.target.value) })}
              className="flex-1"
              style={{ accentColor: "var(--accent)" }}
            />
            <span
              className="font-mono text-[10px] w-7 text-right"
              style={{ color: "var(--text-dim)" }}
            >
              {Math.round((textOpacity ?? 1) * 100)}%
            </span>
          </div>
        </label>
      </div>

      <div className="flex gap-1">
        <button
          onClick={() => patch({ bold: !bold })}
          className={`cap-btn-secondary !px-2 ${bold ? "!text-white" : ""}`}
          style={
            bold
              ? {
                  background: "var(--accent)",
                  borderColor: "var(--accent)",
                  color: "var(--bg-app)",
                }
              : {}
          }
        >
          <Bold size={12} /> Negrita
        </button>
        <button
          onClick={() => patch({ italic: !italic })}
          className={`cap-btn-secondary !px-2 ${italic ? "!text-white" : ""}`}
          style={
            italic
              ? {
                  background: "var(--accent)",
                  borderColor: "var(--accent)",
                  color: "var(--bg-app)",
                }
              : {}
          }
        >
          <Italic size={12} /> Cursiva
        </button>
      </div>

      <div className="border-t pt-2" style={{ borderColor: "var(--border)" }}>
        <div className="flex items-center justify-between mb-1.5">
          <span className="cap-input-label !mb-0">Fondo</span>
          <label
            className="flex items-center gap-1.5 text-[10px] cursor-pointer"
            style={{ color: "var(--text-dim)" }}
          >
            <input
              type="checkbox"
              checked={bgEnabled}
              onChange={(e) => patch({ bgEnabled: e.target.checked })}
            />{" "}
            activo
          </label>
        </div>
        {bgEnabled && (
          <div className="space-y-1.5">
            <div className="grid grid-cols-2 gap-2">
              <label>
                <span className="text-[9px]" style={{ color: "var(--text-dim)" }}>
                  Color
                </span>
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
                <span className="text-[9px]" style={{ color: "var(--text-dim)" }}>
                  Opacidad
                </span>
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
              <span className="text-[9px]" style={{ color: "var(--text-dim)" }}>
                Padding
              </span>
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
      </div>

      <div className="border-t pt-2" style={{ borderColor: "var(--border)" }}>
        <span className="cap-input-label">Borde (stroke)</span>
        <div className="grid grid-cols-2 gap-2">
          <label>
            <span className="text-[9px]" style={{ color: "var(--text-dim)" }}>
              Ancho
            </span>
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
            <span className="text-[9px]" style={{ color: "var(--text-dim)" }}>
              Color
            </span>
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
      </div>

      <div className="border-t pt-2" style={{ borderColor: "var(--border)" }}>
        <div className="flex items-center justify-between mb-1.5">
          <span className="cap-input-label !mb-0">Sombra</span>
          <label
            className="flex items-center gap-1.5 text-[10px] cursor-pointer"
            style={{ color: "var(--text-dim)" }}
          >
            <input
              type="checkbox"
              checked={!!textShadowEnabled}
              onChange={(e) => patch({ textShadowEnabled: e.target.checked })}
            />{" "}
            activa
          </label>
        </div>
        {textShadowEnabled && (
          <div className="space-y-1.5">
            <label>
              <span className="text-[9px]" style={{ color: "var(--text-dim)" }}>
                Color
              </span>
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
                <span className="text-[9px]" style={{ color: "var(--text-dim)" }}>
                  Offset X
                </span>
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
                <span className="text-[9px]" style={{ color: "var(--text-dim)" }}>
                  Offset Y
                </span>
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
      </div>
    </div>
  );
}
