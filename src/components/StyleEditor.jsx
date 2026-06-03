import { Bold, Italic, AlignLeft, AlignCenter, AlignRight } from "lucide-react";
import useEditorStore from "../stores/useEditorStore";
import { FONT_FAMILIES, FONT_WEIGHTS, TEXT_ALIGNS } from "../utils/types";

const NAMED_COLORS = {
  white: "#ffffff",
  black: "#000000",
  red: "#ff0000",
  green: "#008000",
  blue: "#0000ff",
  yellow: "#ffff00",
  gray: "#808080",
  grey: "#808080",
  silver: "#c0c0c0",
  maroon: "#800000",
  olive: "#808000",
  purple: "#800080",
  teal: "#008080",
  navy: "#000080",
  orange: "#ffa500",
  pink: "#ffc0cb",
  brown: "#a52a2a",
  lime: "#00ff00",
  aqua: "#00ffff",
  fuchsia: "#ff00ff",
};

function normalizeColor(c) {
  if (!c) return null;
  const t = String(c).trim().toLowerCase();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/.test(t)) {
    if (t.length === 4) {
      return "#" + t[1] + t[1] + t[2] + t[2] + t[3] + t[3];
    }
    return t;
  }
  return NAMED_COLORS[t] || null;
}

export default function StyleEditor() {
  const store = useEditorStore();
  const isBatch = store.sidebarMode === "batch";
  const {
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
  } = store;

  const patch = (stylePatch) => {
    if (isBatch) store.patchBatchTextStyle(stylePatch);
    else {
      if (stylePatch.fontSize != null) store.setTextFontSize(stylePatch.fontSize);
      if (stylePatch.fontColor != null) store.setTextFontColor(stylePatch.fontColor);
      if (stylePatch.fontFamily != null) store.setFontFamily(stylePatch.fontFamily);
      if (stylePatch.fontWeight != null) store.setFontWeight(stylePatch.fontWeight);
      if (stylePatch.letterSpacing != null) store.setLetterSpacing(stylePatch.letterSpacing);
      if (stylePatch.textAlign != null) store.setTextAlign(stylePatch.textAlign);
      if (stylePatch.textOpacity != null) store.setTextOpacity(stylePatch.textOpacity);
      if (stylePatch.bold != null) store.setBold(stylePatch.bold);
      if (stylePatch.italic != null) store.setItalic(stylePatch.italic);
      if (stylePatch.bgEnabled != null) store.setBgEnabled(stylePatch.bgEnabled);
      if (stylePatch.bgColor != null) store.setBgColor(stylePatch.bgColor);
      if (stylePatch.bgOpacity != null) store.setBgOpacity(stylePatch.bgOpacity);
      if (stylePatch.boxBorderWidth != null) store.setBoxBorderWidth(stylePatch.boxBorderWidth);
      if (stylePatch.borderWidth != null) store.setBorderWidth(stylePatch.borderWidth);
      if (stylePatch.borderColor != null) store.setBorderColor(stylePatch.borderColor);
    }
  };

  return (
    <div className="space-y-2">
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
    </div>
  );
}
