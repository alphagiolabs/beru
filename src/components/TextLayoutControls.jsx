import { AlignStartVertical, AlignCenterVertical, AlignEndVertical } from "lucide-react";
import { VERTICAL_ALIGNS, TRUNCATE_MODES } from "../utils/text-layout";
import { ToggleSwitch, SegmentedToolbar } from "./inspector";

export default function TextLayoutControls({ values = {}, onPatch, disabled = false }) {
  const autoFit = !!values.autoFit;
  const lineHeight = values.lineHeight ?? 1.2;
  const verticalAlign = values.verticalAlign || "top";
  const textWrap = values.textWrap !== false;
  const safeMargin = values.safeMargin ?? 4;
  const truncate = values.truncate || "none";

  const patch = (next) => {
    if (disabled) return;
    onPatch?.(next);
  };

  return (
    <div className="space-y-2">
      <ToggleSwitch
        label="Auto-ajustar al cuadro"
        checked={autoFit}
        disabled={disabled}
        onChange={(next) => patch({ autoFit: next })}
      />

      <div className="grid grid-cols-2 gap-2">
        <label>
          <span className="cap-input-label">Alto de línea</span>
          <input
            type="number"
            value={lineHeight}
            disabled={disabled}
            onChange={(e) => patch({ lineHeight: Number(e.target.value) })}
            className="cap-input font-mono text-[11px]"
            min={0.8}
            max={3}
            step={0.05}
          />
        </label>
        <label>
          <span className="cap-input-label">Margen seguro</span>
          <input
            type="number"
            value={safeMargin}
            disabled={disabled}
            onChange={(e) => patch({ safeMargin: Number(e.target.value) })}
            className="cap-input font-mono text-[11px]"
            min={0}
            max={48}
          />
        </label>
      </div>

      <div>
        <span className="cap-input-label">Alineación vertical</span>
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

      <div className="grid grid-cols-2 gap-2 items-end">
        <ToggleSwitch
          label="Ajuste de línea"
          checked={textWrap}
          disabled={disabled}
          onChange={(next) => patch({ textWrap: next })}
        />
        <label>
          <span className="cap-input-label">Truncado</span>
          <select
            value={truncate}
            disabled={disabled || autoFit}
            onChange={(e) => patch({ truncate: e.target.value })}
            className="cap-input text-[11px]"
          >
            {TRUNCATE_MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {autoFit && (
        <p className="inspector-helper">
          El tamaño se reduce automáticamente para caber en la región. Desactiva auto-ajuste para
          ver avisos de desborde.
        </p>
      )}
    </div>
  );
}
