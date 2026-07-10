import { AlignStartVertical, AlignCenterVertical, AlignEndVertical } from "lucide-react";
import { VERTICAL_ALIGNS, TRUNCATE_MODES } from "../utils/text-layout";

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
    <div className="border-t pt-2 space-y-2" style={{ borderColor: "var(--border)" }}>
      <span className="cap-input-label">Composición</span>

      <label
        className="flex items-center justify-between gap-2 text-[10px] cursor-pointer"
        style={{ color: "var(--text-dim)" }}
      >
        <span>Auto-ajustar al cuadro</span>
        <input
          type="checkbox"
          checked={autoFit}
          disabled={disabled}
          onChange={(e) => patch({ autoFit: e.target.checked })}
        />
      </label>

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
        <div className="grid grid-cols-3 gap-1">
          {VERTICAL_ALIGNS.map((a) => {
            const active = verticalAlign === a.value;
            const Icon =
              a.value === "top"
                ? AlignStartVertical
                : a.value === "center"
                  ? AlignCenterVertical
                  : AlignEndVertical;
            return (
              <button
                key={a.value}
                type="button"
                disabled={disabled}
                onClick={() => patch({ verticalAlign: a.value })}
                className="cap-btn-secondary !text-[10px] !py-1 flex items-center justify-center"
                style={
                  active
                    ? {
                        background: "var(--accent)",
                        color: "var(--bg-app)",
                        borderColor: "var(--accent)",
                      }
                    : {}
                }
                title={a.value}
              >
                <Icon size={12} />
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label
          className="flex items-center justify-between gap-2 text-[10px] cursor-pointer rounded px-2 py-1.5"
          style={{ background: "var(--bg-elevated)", color: "var(--text-dim)" }}
        >
          <span>Ajuste de línea</span>
          <input
            type="checkbox"
            checked={textWrap}
            disabled={disabled}
            onChange={(e) => patch({ textWrap: e.target.checked })}
          />
        </label>
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
        <p className="text-[9px] leading-snug" style={{ color: "var(--text-dim)" }}>
          El tamaño se reduce automáticamente para caber en la región. Desactiva auto-ajuste para
          ver avisos de desborde.
        </p>
      )}
    </div>
  );
}
