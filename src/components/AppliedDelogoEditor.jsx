import { Upload, X } from "lucide-react";
import { clampRegionToVideo } from "../utils/video-utils";
import { DELOGO_METHODS, MIRROR_SIDES } from "../utils/types";
import useEditorStore from "../stores/useEditorStore";
import { useT } from "../i18n/useT";
import { Button } from "./ui/Button";

const TITLES = {
  blur: "Desenfoque aplicado",
  delogo: "Quitar logo aplicado",
  crop: "Recorte aplicado",
};

function RegionFields({ region, dims, onPatchRegion }) {
  const dimFor = (key) => (key === "x" || key === "w" ? dims.w : dims.h);
  return (
    <div className="grid grid-cols-4 gap-1.5">
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
            aria-label={label}
            value={Math.round((region[key] || 0) * (dimFor(key) || 1))}
            onChange={(e) => {
              const px = Number(e.target.value);
              const dim = dimFor(key);
              if (!Number.isFinite(px) || !dim) return;
              const next = clampRegionToVideo({ ...region, [key]: px / dim });
              if (next) onPatchRegion(next);
            }}
            className="cap-input font-mono text-[11px]"
            min={0}
          />
        </label>
      ))}
    </div>
  );
}

function TemporalFields({ op, onPatch }) {
  return (
    <div>
      <span className="cap-input-label">Rango temporal</span>
      <div className="grid grid-cols-2 gap-2">
        <label>
          <span className="cap-input-label">Inicio (s)</span>
          <input
            type="number"
            value={op.startTime ?? ""}
            onChange={(e) => onPatch({ startTime: e.target.value ? Number(e.target.value) : null })}
            placeholder="0"
            className="cap-input font-mono text-[11px]"
          />
        </label>
        <label>
          <span className="cap-input-label">Fin (s)</span>
          <input
            type="number"
            value={op.endTime ?? ""}
            onChange={(e) => onPatch({ endTime: e.target.value ? Number(e.target.value) : null })}
            placeholder="final"
            className="cap-input font-mono text-[11px]"
          />
        </label>
      </div>
      {op.startTime != null && op.endTime != null && op.endTime <= op.startTime && (
        <div
          className="cap-card text-[11px] leading-relaxed mt-1"
          style={{ color: "#ef4444", borderColor: "rgba(239,68,68,0.3)" }}
        >
          El rango es inválido (Fin ≤ Inicio). La operación no se aplicará en la exportación.
        </div>
      )}
    </div>
  );
}

function CoverPicker({ op, onPatch }) {
  const t = useT();
  const get = useEditorStore.getState;
  return (
    <div>
      <span className="cap-input-label">Imagen de cobertura</span>
      <div className="flex gap-1.5">
        <input
          type="text"
          value={op.delogoImagePath ? op.delogoImagePath.split(/[\\/]/).pop() : ""}
          placeholder="Seleccionar imagen..."
          readOnly
          className="cap-input flex-1 font-mono text-[10px] truncate"
        />
        <Button
          type="button"
          onClick={async () => {
            const res = await window.api?.pickImage();
            if (res?.success) {
              onPatch({ delogoImagePath: res.path });
              const r = await window.api?.readImage(res.path);
              if (r?.success) {
                get().cacheImageData(res.path, r.dataUrl);
              }
            } else if (res && !res.canceled) {
              get().showToast?.({
                kind: "err",
                text: res.error || "No se pudo cargar la imagen",
              });
            }
          }}
          variant="secondary"
          size="sm"
          className="!text-[10px] !px-2"
        >
          <Upload size={12} /> Elegir
        </Button>
        {op.delogoImagePath && (
          <Button
            type="button"
            onClick={() => onPatch({ delogoImagePath: "" })}
            variant="tertiary"
            size="icon"
            className="text-[var(--rose)]"
            style={{ color: "var(--rose)" }}
            title={t("common.remove")}
            aria-label={t("common.remove")}
          >
            <X size={12} />
          </Button>
        )}
      </div>
    </div>
  );
}

function DelogoFields({ op, onPatch }) {
  const method = op.delogoMethod || "blur";
  return (
    <div className="space-y-2">
      <span className="cap-input-label">Método</span>
      <div className="grid grid-cols-3 gap-1">
        {DELOGO_METHODS.map((m) => {
          const active = method === m.id;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => onPatch({ delogoMethod: m.id })}
              className={`inspector-chip !min-h-[32px]${active ? " is-selected" : ""}`}
              style={
                active
                  ? { background: "var(--rose)", color: "white", borderColor: "var(--rose)" }
                  : undefined
              }
              title={m.description}
            >
              <span className="text-[10px]">{m.label}</span>
            </button>
          );
        })}
      </div>
      <p className="inspector-helper">{DELOGO_METHODS.find((m) => m.id === method)?.description}</p>

      {method === "blur" && (
        <div
          className="flex items-center gap-2 text-[11px] min-w-0"
          style={{ color: "var(--text-dim)" }}
        >
          Intensidad blur
          <input
            type="range"
            min="2"
            max="60"
            value={op.blurStrength ?? 20}
            onChange={(e) => onPatch({ blurStrength: Number(e.target.value) })}
            className="inspector-range"
            aria-label="Intensidad blur"
          />
          <span
            className="font-mono text-xs w-6 text-right"
            style={{ color: "var(--accent-brand)" }}
          >
            {op.blurStrength ?? 20}
          </span>
        </div>
      )}

      {method === "temporal" && (
        <div
          className="flex items-center gap-2 text-[11px] min-w-0"
          style={{ color: "var(--text-dim)" }}
        >
          Radio (frames)
          <input
            type="range"
            min="1"
            max="15"
            value={op.temporalRadius ?? 3}
            onChange={(e) => onPatch({ temporalRadius: Number(e.target.value) })}
            className="inspector-range"
            aria-label="Radio temporal"
          />
          <span
            className="font-mono text-xs w-6 text-right"
            style={{ color: "var(--accent-brand)" }}
          >
            {op.temporalRadius ?? 3}
          </span>
        </div>
      )}

      {method === "mosaic" && (
        <div
          className="flex items-center gap-2 text-[11px] min-w-0"
          style={{ color: "var(--text-dim)" }}
        >
          Tamaño bloque
          <input
            type="range"
            min="4"
            max="40"
            value={op.mosaicSize ?? 12}
            onChange={(e) => onPatch({ mosaicSize: Number(e.target.value) })}
            className="inspector-range"
            aria-label="Tamaño bloque"
          />
          <span
            className="font-mono text-xs w-6 text-right"
            style={{ color: "var(--accent-brand)" }}
          >
            {op.mosaicSize ?? 12}px
          </span>
        </div>
      )}

      {method === "mirror" && (
        <div>
          <span className="cap-input-label">Lado a reflejar</span>
          <div className="grid grid-cols-2 gap-1">
            {MIRROR_SIDES.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => onPatch({ mirrorSide: s.id })}
                className={`inspector-chip${(op.mirrorSide || "right") === s.id ? " is-selected" : ""}`}
                style={
                  (op.mirrorSide || "right") === s.id
                    ? { background: "var(--rose)", color: "white", borderColor: "var(--rose)" }
                    : undefined
                }
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {method === "fill" && (
        <div className="space-y-2">
          <label className="flex items-center gap-2">
            <span className="cap-input-label !mb-0">Color</span>
            <input
              type="color"
              value={op.delogoFillColor || "#000000"}
              onChange={(e) => onPatch({ delogoFillColor: e.target.value })}
              className="w-6 h-6 rounded cursor-pointer border-0"
              aria-label="Color de relleno"
            />
          </label>
          <div
            className="flex items-center gap-2 text-[11px] min-w-0"
            style={{ color: "var(--text-dim)" }}
          >
            Opacidad
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={op.delogoFillOpacity ?? 1}
              onChange={(e) => onPatch({ delogoFillOpacity: Number(e.target.value) })}
              className="inspector-range"
              aria-label="Opacidad de relleno"
            />
            <span
              className="font-mono text-xs w-6 text-right"
              style={{ color: "var(--accent-brand)" }}
            >
              {Number(op.delogoFillOpacity ?? 1).toFixed(2)}
            </span>
          </div>
        </div>
      )}

      {method === "cover" && <CoverPicker op={op} onPatch={onPatch} />}

      <div
        className="flex items-center gap-2 text-[11px] min-w-0"
        style={{ color: "var(--text-dim)" }}
      >
        <span title="Suaviza el borde entre la zona restaurada y el video original">
          Feather borde
        </span>
        <input
          type="range"
          min="0"
          max="20"
          value={op.edgeFeather ?? 6}
          onChange={(e) => onPatch({ edgeFeather: Number(e.target.value) })}
          className="inspector-range"
          aria-label="Feather borde"
        />
        <span className="font-mono text-xs w-8 text-right" style={{ color: "var(--accent-brand)" }}>
          {op.edgeFeather ?? 6}px
        </span>
      </div>
    </div>
  );
}

export default function AppliedDelogoEditor({ op, videoIdx, opIdx, video }) {
  if (!op || !["blur", "delogo", "crop"].includes(op.mode)) return null;
  const get = useEditorStore.getState;
  const dims = { w: video?.width || 1920, h: video?.height || 1080 };
  const region = op.region || { x: 0, y: 0, w: 0.2, h: 0.2 };
  const onPatch = (patch) => get().updateOperation(videoIdx, opIdx, patch);
  const onPatchRegion = (next) => get().updateOperation(videoIdx, opIdx, { region: next });

  return (
    <div className="space-y-2.5" data-applied-region-editor={op.mode}>
      <div>
        <div className="cap-section-title">{TITLES[op.mode]}</div>
        <p className="inspector-helper">
          Zona seleccionada en el video. Arrástrala para moverla y usa las esquinas para
          redimensionarla sin dibujar de nuevo.
        </p>
      </div>

      <RegionFields region={region} dims={dims} onPatchRegion={onPatchRegion} />

      {op.mode === "blur" && (
        <div
          className="flex items-center gap-2 text-[11px] min-w-0"
          style={{ color: "var(--text-dim)" }}
        >
          Intensidad
          <input
            type="range"
            min="2"
            max="60"
            value={op.blurStrength ?? 20}
            onChange={(e) => onPatch({ blurStrength: Number(e.target.value) })}
            className="inspector-range"
            aria-label="Intensidad de desenfoque"
          />
          <span
            className="font-mono text-xs w-6 text-right"
            style={{ color: "var(--accent-brand)" }}
          >
            {op.blurStrength ?? 20}
          </span>
        </div>
      )}

      {op.mode === "delogo" && <DelogoFields op={op} onPatch={onPatch} />}

      <TemporalFields op={op} onPatch={onPatch} />

      <div className="flex gap-1.5">
        <Button
          type="button"
          onClick={() => get().removeOperationAt(videoIdx, opIdx)}
          variant="danger"
          size="sm"
          className="flex-1 !text-[10px]"
          style={{ color: "var(--rose)" }}
        >
          Eliminar zona
        </Button>
        <Button
          type="button"
          onClick={() => get().selectOperation(null)}
          variant="secondary"
          size="sm"
          className="flex-1 !text-[10px]"
        >
          Deseleccionar
        </Button>
      </div>
    </div>
  );
}
