import { AlignStartVertical, AlignCenterVertical, AlignEndVertical } from "lucide-react";
import { VERTICAL_ALIGNS, TRUNCATE_MODES } from "../utils/text-layout";
import { ToggleSwitch, SegmentedToolbar } from "./inspector";

export default function TextLayoutControls({
  values = {},
  onPatch,
  disabled = false,
  /** When true, render horizontal align (StyleEditor Párrafo). AppliedTextEditor keeps its own. */
  showTextAlign = false,
  textAlignOptions = null,
}) {
  const autoFit = !!values.autoFit;
  const lineHeight = values.lineHeight ?? 1.2;
  const verticalAlign = values.verticalAlign || "top";
  const textWrap = values.textWrap !== false;
  const safeMargin = values.safeMargin ?? 4;
  const truncate = values.truncate || "none";
  const textAlign = values.textAlign || "left";

  const patch = (next) => {
    if (disabled) return;
    onPatch?.(next);
  };

  return (
    <div className="inspector-paragraph">
      <div className={`inspector-paragraph-aligns${showTextAlign ? " has-h" : ""}`}>
        {showTextAlign && textAlignOptions ? (
          <div className="inspector-paragraph-align-block">
            <span className="inspector-paragraph-micro">H</span>
            <SegmentedToolbar
              ariaLabel="Alineación horizontal"
              columns={3}
              value={textAlign}
              disabled={disabled}
              onChange={(value) => patch({ textAlign: value })}
              options={textAlignOptions}
            />
          </div>
        ) : null}

        <div className="inspector-paragraph-align-block">
          <span className="inspector-paragraph-micro">{showTextAlign ? "V" : "Vertical"}</span>
          <SegmentedToolbar
            ariaLabel="Alineación vertical"
            columns={3}
            value={verticalAlign}
            disabled={disabled}
            onChange={(value) => patch({ verticalAlign: value })}
            options={VERTICAL_ALIGNS.map((a) => ({
              value: a.value,
              title: a.value,
              icon:
                a.value === "top" ? (
                  <AlignStartVertical size={12} />
                ) : a.value === "center" ? (
                  <AlignCenterVertical size={12} />
                ) : (
                  <AlignEndVertical size={12} />
                ),
            }))}
          />
        </div>
      </div>

      <div className="inspector-paragraph-metrics" role="group" aria-label="Métricas de párrafo">
        <label className="inspector-paragraph-metric">
          <span className="inspector-paragraph-metric-key">Línea</span>
          <input
            type="number"
            inputMode="decimal"
            aria-label="Alto de línea"
            value={lineHeight}
            disabled={disabled}
            onChange={(e) => patch({ lineHeight: Number(e.target.value) })}
            className="inspector-paragraph-metric-input"
            min={0.8}
            max={3}
            step={0.05}
          />
        </label>
        <label className="inspector-paragraph-metric">
          <span className="inspector-paragraph-metric-key">Margen</span>
          <input
            type="number"
            inputMode="numeric"
            aria-label="Margen seguro"
            value={safeMargin}
            disabled={disabled}
            onChange={(e) => patch({ safeMargin: Number(e.target.value) })}
            className="inspector-paragraph-metric-input"
            min={0}
            max={48}
          />
        </label>
      </div>

      <div className="inspector-paragraph-list">
        <ToggleSwitch
          label="Auto-ajustar"
          checked={autoFit}
          disabled={disabled}
          onChange={(next) => patch({ autoFit: next })}
        />
        <ToggleSwitch
          label="Ajuste de línea"
          checked={textWrap}
          disabled={disabled}
          onChange={(next) => patch({ textWrap: next })}
        />
      </div>

      <div className={`inspector-paragraph-truncate${autoFit || disabled ? " is-disabled" : ""}`}>
        <span className="inspector-paragraph-micro">Truncado</span>
        <SegmentedToolbar
          ariaLabel="Truncado"
          columns={3}
          value={truncate}
          disabled={disabled || autoFit}
          onChange={(value) => patch({ truncate: value })}
          options={TRUNCATE_MODES.map((m) => ({
            value: m.value,
            label: m.label,
            title: m.title || m.label,
            ariaLabel: m.title || m.label,
          }))}
        />
      </div>

      {autoFit ? (
        <p className="inspector-helper inspector-paragraph-hint">
          Reduce el tamaño para caber en la región.
        </p>
      ) : null}
    </div>
  );
}
