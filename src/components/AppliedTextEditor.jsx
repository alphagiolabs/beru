import { AlignCenter, AlignLeft, AlignRight } from "lucide-react";
import { clampRegionToVideo } from "../utils/video-utils";
import { TEXT_ALIGNS } from "../utils/types";
import TextLayoutControls from "./TextLayoutControls";

export default function AppliedTextEditor({
  op,
  video,
  onPatch,
  title = "Texto aplicado",
  showContent = true,
}) {
  if (!op || op.mode !== "text") return null;

  const vw = video?.width || video?.sourceWidth || 1920;
  const vh = video?.height || video?.sourceHeight || 1080;
  const region = op.region || { x: 0, y: 0, w: 0.3, h: 0.1 };
  const dimFor = (key) => (key === "x" || key === "w" ? vw : vh);

  const patchRegionKey = (key, px) => {
    const dim = dimFor(key);
    if (!Number.isFinite(px) || !dim) return;
    onPatch({
      region: clampRegionToVideo({
        ...region,
        [key]: px / dim,
      }),
    });
  };

  return (
    <div className="mb-3 space-y-2 border-t pt-3" style={{ borderColor: "var(--border)" }}>
      <div className="cap-section-title">{title}</div>

      {showContent && (
        <label>
          <span className="cap-input-label">Contenido</span>
          <textarea
            value={op.text || ""}
            onChange={(e) => onPatch({ text: e.target.value })}
            rows={2}
            className="cap-input text-[11px] resize-y"
            style={{ fontFamily: `"${op.fontFamily || "Arial"}", sans-serif` }}
          />
        </label>
      )}

      <div className="grid grid-cols-2 gap-2">
        <label>
          <span className="cap-input-label">Tamaño</span>
          <input
            type="number"
            value={op.fontSize ?? 32}
            onChange={(e) => onPatch({ fontSize: Number(e.target.value) })}
            className="cap-input font-mono text-[11px]"
            min={8}
            max={200}
          />
        </label>
        <label>
          <span className="cap-input-label">Espaciado</span>
          <input
            type="number"
            value={op.letterSpacing ?? 0}
            onChange={(e) => onPatch({ letterSpacing: Number(e.target.value) })}
            className="cap-input font-mono text-[11px]"
            step={0.5}
          />
        </label>
      </div>

      <div>
        <span className="cap-input-label">Alineación</span>
        <div className="grid grid-cols-3 gap-1">
          {TEXT_ALIGNS.map((a) => {
            const active = (op.textAlign || "left") === a.value;
            return (
              <button
                key={a.value}
                type="button"
                onClick={() => onPatch({ textAlign: a.value })}
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
                title={`Alinear ${a.value}`}
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
        values={{
          autoFit: op.autoFit,
          lineHeight: op.lineHeight,
          verticalAlign: op.verticalAlign,
          textWrap: op.textWrap,
          safeMargin: op.safeMargin,
          truncate: op.truncate,
        }}
        onPatch={onPatch}
      />

      <div className="border-t pt-2" style={{ borderColor: "var(--border)" }}>
        <div className="flex items-center justify-between mb-1.5">
          <span className="cap-input-label !mb-0">Cuadro de texto</span>
          <span className="text-[9px] font-mono" style={{ color: "var(--text-dim)" }}>
            {Math.round(region.w * vw)}×{Math.round(region.h * vh)} px
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {[
            ["X", "x"],
            ["Y", "y"],
            ["W", "w"],
            ["H", "h"],
          ].map(([label, key]) => (
            <label key={key}>
              <span className="cap-input-label">{label}</span>
              <input
                type="number"
                value={Math.round((region[key] || 0) * dimFor(key))}
                onChange={(e) => patchRegionKey(key, Number(e.target.value))}
                className="cap-input font-mono text-[11px]"
                min={0}
              />
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
