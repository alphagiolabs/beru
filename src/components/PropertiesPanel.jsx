import { shallow } from "zustand/shallow";
import useEditorStore from "../stores/useEditorStore";
import { useT } from "../i18n/useT";
import StyleEditor from "./StyleEditor";
import PresetManager from "./PresetManager";
import BatchPanel from "./BatchPanel";
import AppliedTextEditor from "./AppliedTextEditor";
import { isRegionUsable } from "../utils/video-utils";
import { DELOGO_METHODS, MIRROR_SIDES } from "../utils/types";
import {
  Timer,
  FlipHorizontal2,
  Grid3x3,
  Sparkles,
  Droplet,
  PaintBucket,
  Eye,
  Upload,
} from "lucide-react";

const DELOGO_ICONS = {
  temporal: Timer,
  mirror: FlipHorizontal2,
  mosaic: Grid3x3,
  inpaint: Sparkles,
  blur: Droplet,
  fill: PaintBucket,
};

export default function PropertiesPanel() {
  const {
    sel,
    currentRegion,
    activeTool,
    sidebarMode,
    tempImagePath,
    tempImageDataUrl,
    tempImageOpacity,
    tempImageScale,
    blurStrength,
    delogoMethod,
    delogoImagePath,
    delogoFillColor,
    delogoFillOpacity,
    temporalRadius,
    mosaicSize,
    mirrorSide,
    edgeFeather,
    selectedIdx,
    selectedOperationIdx,
    selectedOperation,
    selectedTemplateRegion,
  } = useEditorStore(
    (s) => ({
      selectedIdx: s.selectedIdx,
      sel: s.selectedIdx >= 0 && s.selectedIdx < s.queue.length ? s.queue[s.selectedIdx] : null,
      selectedOperationIdx: s.selectedOperationIdx,
      selectedOperation:
        s.selectedIdx >= 0 &&
        s.selectedIdx < s.queue.length &&
        s.selectedOperationIdx != null &&
        s.selectedOperationIdx >= 0 &&
        s.selectedOperationIdx < s.queue[s.selectedIdx].operations.length
          ? s.queue[s.selectedIdx].operations[s.selectedOperationIdx]
          : null,
      selectedTemplateRegion:
        s.selectedTemplateRegionId != null
          ? s.templateRegions.find((tr) => tr.id === s.selectedTemplateRegionId)
          : null,
      currentRegion: s.currentRegion,
      activeTool: s.activeTool,
      sidebarMode: s.sidebarMode,
      tempImagePath: s.tempImagePath,
      tempImageDataUrl: s.tempImageDataUrl,
      tempImageOpacity: s.tempImageOpacity,
      tempImageScale: s.tempImageScale,
      blurStrength: s.blurStrength,
      delogoMethod: s.delogoMethod,
      delogoImagePath: s.delogoImagePath,
      delogoFillColor: s.delogoFillColor,
      delogoFillOpacity: s.delogoFillOpacity,
      temporalRadius: s.temporalRadius,
      mosaicSize: s.mosaicSize,
      mirrorSide: s.mirrorSide,
      edgeFeather: s.edgeFeather,
    }),
    shallow,
  );
  const showToast = useEditorStore((s) => s.showToast);
  const get = useEditorStore.getState;
  const t = useT();

  return (
    <div className="cap-section">
      {/* Mode tabs */}
      <div
        className="flex rounded mb-3 overflow-hidden border"
        style={{ borderColor: "var(--border)" }}
      >
        <button
          onClick={() => get().setSidebarMode("logo")}
          className="flex-1 py-1.5 text-[10px] font-medium text-center transition-colors"
          style={{
            background: sidebarMode === "logo" ? "var(--accent)" : "transparent",
            color: sidebarMode === "logo" ? "var(--bg-app)" : "var(--text-dim)",
          }}
        >
          Quitar logo
        </button>
        <button
          onClick={() => get().setSidebarMode("batch")}
          className="flex-1 py-1.5 text-[10px] font-medium text-center transition-colors"
          style={{
            background: sidebarMode === "batch" ? "#a855f7" : "transparent",
            color: sidebarMode === "batch" ? "white" : "var(--text-dim)",
          }}
        >
          Texto en lote
        </button>
      </div>

      <div className="cap-section-title">
        Región ·{" "}
        <span
          className="normal-case tracking-normal font-normal"
          style={{ color: "var(--text-secondary)" }}
        >
          {sel?.filename}
        </span>
      </div>

      {currentRegion && (
        <>
          {/* Coordinate inputs (display in pixels for the current video) */}
          <div className="grid grid-cols-2 gap-2 mb-3">
            {(() => {
              const vw = sel?.width || 0;
              const vh = sel?.height || 0;
              const dimFor = (k) => (k === "x" || k === "w" ? vw : vh);
              return [
                ["X", "x"],
                ["Y", "y"],
                ["W", "w"],
                ["H", "h"],
              ].map(([label, key]) => (
                <label key={key}>
                  <span className="cap-input-label">{label}</span>
                  <input
                    type="number"
                    value={Math.round((currentRegion[key] || 0) * (dimFor(key) || 1))}
                    onChange={(e) => {
                      const px = Number(e.target.value);
                      if (!Number.isFinite(px) || !dimFor(key)) return;
                      get().updateRegionValue(key, px / dimFor(key));
                    }}
                    className="cap-input font-mono text-[11px]"
                  />
                </label>
              ));
            })()}
          </div>

          {/* Image picker + opacity + scale (image mode - Canva style) */}
          {sidebarMode === "logo" && activeTool === "image" && (
            <div className="mb-3 space-y-2">
              <div className="cap-input-label">Marca de agua</div>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={tempImagePath ? tempImagePath.split(/[\\/]/).pop() : ""}
                  placeholder="Seleccionar logo..."
                  readOnly
                  className="cap-input flex-1 font-mono text-[10px] truncate"
                />
                <button
                  onClick={async () => {
                    const res = await window.api?.pickImage();
                    if (res?.success) {
                      get().setTempImagePath(res.path);
                      const r = await window.api?.readImage(res.path);
                      if (r?.success) get().setTempImageDataUrl(r.dataUrl);
                      else
                        showToast({
                          kind: "err",
                          text: r?.error || t("errors.imageReadFailed"),
                        });
                    }
                  }}
                  className="cap-btn-secondary !text-[10px] !px-2"
                >
                  Elegir
                </button>
                {tempImagePath && (
                  <button
                    onClick={() => {
                      get().setTempImagePath("");
                      get().setTempImageDataUrl("");
                    }}
                    className="cap-btn-secondary !text-[10px] !px-2"
                    style={{ color: "var(--rose)" }}
                  >
                    ×
                  </button>
                )}
              </div>
              {tempImageDataUrl && (
                <div
                  className="rounded overflow-hidden border"
                  style={{ borderColor: "var(--border)" }}
                >
                  <img
                    src={tempImageDataUrl}
                    alt="preview"
                    className="block w-full max-h-32 object-contain"
                    style={{ background: "var(--bg-app)" }}
                  />
                </div>
              )}
              <div
                className="flex items-center gap-2 text-[10px]"
                style={{ color: "var(--text-dim)" }}
              >
                Opacidad
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={tempImageOpacity}
                  onChange={(e) => get().setTempImageOpacity(Number(e.target.value))}
                  className="flex-1"
                />
                <span
                  className="font-mono text-xs w-8 text-right"
                  style={{ color: "var(--accent)" }}
                >
                  {Math.round(tempImageOpacity * 100)}%
                </span>
              </div>
              <div
                className="flex items-center gap-2 text-[10px]"
                style={{ color: "var(--text-dim)" }}
              >
                Escala
                <input
                  type="range"
                  min="0.1"
                  max="3"
                  step="0.1"
                  value={tempImageScale || 1}
                  onChange={(e) => {
                    const scale = Number(e.target.value);
                    get().setTempImageScale(scale);
                    if (currentRegion) {
                      const baseW = currentRegion.baseW || currentRegion.w;
                      const baseH = currentRegion.baseH || currentRegion.h;
                      get().setCurrentRegion({
                        ...currentRegion,
                        baseW,
                        baseH,
                        w: baseW * scale,
                        h: baseH * scale,
                      });
                    }
                  }}
                  className="flex-1"
                />
                <span
                  className="font-mono text-xs w-8 text-right"
                  style={{ color: "var(--accent)" }}
                >
                  {(tempImageScale || 1).toFixed(1)}x
                </span>
              </div>
              <div className="cap-input-label !mt-3">Posición rápida</div>
              <div className="grid grid-cols-3 gap-1">
                {[
                  { label: "↖", x: 0.02, y: 0.02 },
                  { label: "↑", x: 0.5, y: 0.02 },
                  { label: "↗", x: 0.98, y: 0.02 },
                  { label: "←", x: 0.02, y: 0.5 },
                  { label: "⊕", x: 0.5, y: 0.5 },
                  { label: "→", x: 0.98, y: 0.5 },
                  { label: "↙", x: 0.02, y: 0.98 },
                  { label: "↓", x: 0.5, y: 0.98 },
                  { label: "↘", x: 0.98, y: 0.98 },
                ].map((pos) => (
                  <button
                    key={pos.label}
                    onClick={() => {
                      const w = currentRegion?.w || 0.15;
                      const h = currentRegion?.h || 0.15;
                      let x = pos.x;
                      let y = pos.y;
                      if (pos.x === 0.98) x = pos.x - w;
                      else if (pos.x === 0.5) x = pos.x - w / 2;
                      if (pos.y === 0.98) y = pos.y - h;
                      else if (pos.y === 0.5) y = pos.y - h / 2;
                      get().setCurrentRegion({ x, y, w, h, baseW: w, baseH: h });
                    }}
                    className="cap-btn-secondary !text-xs !p-1.5"
                    title={pos.label}
                  >
                    {pos.label}
                  </button>
                ))}
              </div>
              <div className="text-[9px] text-center mt-1" style={{ color: "var(--text-muted)" }}>
                Arrastra el logo en el video para posicionarlo
              </div>
            </div>
          )}

          {/* Blur strength */}
          {sidebarMode === "logo" && activeTool === "blur" && (
            <div
              className="mb-3 flex items-center gap-2 text-[10px]"
              style={{ color: "var(--text-dim)" }}
            >
              Intensidad blur
              <input
                type="range"
                min="2"
                max="60"
                value={blurStrength}
                onChange={(e) => get().setBlurStrength(Number(e.target.value))}
                className="flex-1"
              />
              <span className="font-mono text-xs w-6 text-right" style={{ color: "var(--accent)" }}>
                {blurStrength}
              </span>
            </div>
          )}

          {/* Delogo method selector */}
          {sidebarMode === "logo" && activeTool === "delogo" && (
            <div className="mb-3">
              <div className="flex items-center justify-between mb-1.5">
                <span className="cap-input-label !mb-0">Método de eliminación</span>
                <span
                  className="flex items-center gap-1 text-[9px] font-medium"
                  style={{ color: "var(--rose)" }}
                  title="El resultado se muestra en vivo sobre el video"
                >
                  <Eye size={10} /> Vista previa en vivo
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1 mb-2">
                {DELOGO_METHODS.map((m) => {
                  const Icon = DELOGO_ICONS[m.id];
                  const active = delogoMethod === m.id;
                  return (
                    <button
                      key={m.id}
                      onClick={() => get().setDelogoMethod(m.id)}
                      className="cap-btn-secondary !text-[10px] !py-1.5"
                      style={{
                        background: active ? "var(--rose)" : "var(--bg-elevated)",
                        color: active ? "white" : "var(--text-dim)",
                        borderColor: active ? "var(--rose)" : "var(--border)",
                      }}
                      title={m.description}
                    >
                      {Icon && <Icon size={11} />}
                      <span>{m.label}</span>
                    </button>
                  );
                })}
              </div>
              <div
                className="text-[9px] mb-2 leading-relaxed"
                style={{ color: "var(--text-muted)" }}
              >
                {DELOGO_METHODS.find((m) => m.id === delogoMethod)?.description}
              </div>

              {/* Method-specific parameters */}
              {delogoMethod === "temporal" && (
                <div
                  className="flex items-center gap-2 text-[10px] mb-1"
                  style={{ color: "var(--text-dim)" }}
                >
                  Radio (frames)
                  <input
                    type="range"
                    min="1"
                    max="15"
                    value={temporalRadius}
                    onChange={(e) => get().setTemporalRadius(e.target.value)}
                    className="flex-1"
                  />
                  <span
                    className="font-mono text-xs w-6 text-right"
                    style={{ color: "var(--accent)" }}
                  >
                    {temporalRadius}
                  </span>
                </div>
              )}

              {delogoMethod === "mosaic" && (
                <div
                  className="flex items-center gap-2 text-[10px] mb-1"
                  style={{ color: "var(--text-dim)" }}
                >
                  Tamaño bloque
                  <input
                    type="range"
                    min="4"
                    max="40"
                    value={mosaicSize}
                    onChange={(e) => get().setMosaicSize(e.target.value)}
                    className="flex-1"
                  />
                  <span
                    className="font-mono text-xs w-6 text-right"
                    style={{ color: "var(--accent)" }}
                  >
                    {mosaicSize}px
                  </span>
                </div>
              )}

              {delogoMethod === "mirror" && (
                <div className="mb-1">
                  <div className="cap-input-label mb-1">Lado a reflejar</div>
                  <div className="grid grid-cols-2 gap-1">
                    {MIRROR_SIDES.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => get().setMirrorSide(s.id)}
                        className="cap-btn-secondary !text-[9px] !py-1"
                        style={{
                          background: mirrorSide === s.id ? "var(--rose)" : "var(--bg-elevated)",
                          color: mirrorSide === s.id ? "white" : "var(--text-dim)",
                          borderColor: mirrorSide === s.id ? "var(--rose)" : "var(--border)",
                        }}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {delogoMethod === "blur" && (
                <div
                  className="flex items-center gap-2 text-[10px] mb-1"
                  style={{ color: "var(--text-dim)" }}
                >
                  Intensidad blur
                  <input
                    type="range"
                    min="2"
                    max="60"
                    value={blurStrength}
                    onChange={(e) => get().setBlurStrength(e.target.value)}
                    className="flex-1"
                  />
                  <span
                    className="font-mono text-xs w-6 text-right"
                    style={{ color: "var(--accent)" }}
                  >
                    {blurStrength}
                  </span>
                </div>
              )}

              {delogoMethod === "fill" && (
                <div className="space-y-2">
                  <label className="flex items-center gap-2">
                    <span className="cap-input-label">Color</span>
                    <input
                      type="color"
                      value={delogoFillColor}
                      onChange={(e) => get().setDelogoFillColor(e.target.value)}
                      className="w-6 h-6 rounded cursor-pointer border-0"
                    />
                    <span className="font-mono text-[10px]" style={{ color: "var(--text-dim)" }}>
                      {delogoFillColor}
                    </span>
                  </label>
                  <div
                    className="flex items-center gap-2 text-[10px]"
                    style={{ color: "var(--text-dim)" }}
                  >
                    Opacidad
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={delogoFillOpacity}
                      onChange={(e) => get().setDelogoFillOpacity(e.target.value)}
                      className="flex-1"
                    />
                    <span
                      className="font-mono text-xs w-6 text-right"
                      style={{ color: "var(--accent)" }}
                    >
                      {delogoFillOpacity.toFixed(2)}
                    </span>
                  </div>
                </div>
              )}

              {delogoMethod === "cover" && (
                <div className="mb-1">
                  <div className="cap-input-label mb-1">Imagen de cobertura</div>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      value={delogoImagePath ? delogoImagePath.split(/[\\/]/).pop() : ""}
                      placeholder="Seleccionar imagen..."
                      readOnly
                      className="cap-input flex-1 font-mono text-[10px] truncate"
                    />
                    <button
                      onClick={async () => {
                        const res = await window.api?.pickImage();
                        if (res?.success) {
                          get().setDelogoImagePath(res.path);
                        } else if (res && !res.canceled) {
                          get().showToast(res.error || "No se pudo cargar la imagen", "error");
                        }
                      }}
                      className="cap-btn-secondary !text-[10px] !px-2 flex items-center gap-1"
                    >
                      <Upload size={12} /> Elegir
                    </button>
                    {delogoImagePath && (
                      <button
                        onClick={() => get().setDelogoImagePath("")}
                        className="cap-btn-secondary !text-[10px] !px-2"
                        style={{ color: "var(--rose)" }}
                      >
                        ×
                      </button>
                    )}
                  </div>
                  {!delogoImagePath && (
                    <div
                      className="text-[9px] mt-1 leading-relaxed"
                      style={{ color: "var(--rose)" }}
                    >
                      Selecciona una imagen o el método caerá a “Temporal”.
                    </div>
                  )}
                </div>
              )}

              {/* Edge feathering - applies to ALL methods for invisible borders */}
              <div
                className="flex items-center gap-2 text-[10px] mt-2 pt-2 border-t"
                style={{ color: "var(--text-dim)", borderColor: "var(--border)" }}
              >
                <span title="Suaviza el borde entre la zona restaurada y el video original">
                  Feather borde
                </span>
                <input
                  type="range"
                  min="0"
                  max="20"
                  value={edgeFeather}
                  onChange={(e) => get().setEdgeFeather(e.target.value)}
                  className="flex-1"
                />
                <span
                  className="font-mono text-xs w-8 text-right"
                  style={{ color: "var(--accent)" }}
                >
                  {edgeFeather}px
                </span>
              </div>
            </div>
          )}

          {/* Text style editor */}
          {(activeTool === "text" || sidebarMode === "batch") && (
            <div className="mb-3 space-y-2">
              {sidebarMode === "logo" ? (
                <label>
                  <span className="cap-input-label">Contenido</span>
                  <input
                    type="text"
                    value={get().textInput}
                    onChange={(e) => get().setTextInput(e.target.value)}
                    placeholder="Texto..."
                    className="cap-input"
                  />
                </label>
              ) : (
                <div
                  className="cap-card text-[10px] leading-relaxed"
                  style={{ color: "rgba(168,85,247,0.85)", borderColor: "rgba(168,85,247,0.3)" }}
                >
                  La región define posición y tamaño. El texto se cargará desde Excel.
                </div>
              )}
              <StyleEditor />
              <PresetManager />
            </div>
          )}

          {/* Time range */}
          {sidebarMode === "logo" && (
            <div className="grid grid-cols-2 gap-2 mb-3">
              <label>
                <span className="cap-input-label">Inicio (s)</span>
                <input
                  type="number"
                  value={get().tempStart ?? ""}
                  onChange={(e) =>
                    get().setTempStart(e.target.value ? Number(e.target.value) : null)
                  }
                  placeholder="0"
                  className="cap-input font-mono text-[11px]"
                />
              </label>
              <label>
                <span className="cap-input-label">Fin (s)</span>
                <input
                  type="number"
                  value={get().tempEnd ?? ""}
                  onChange={(e) => get().setTempEnd(e.target.value ? Number(e.target.value) : null)}
                  placeholder="final"
                  className="cap-input font-mono text-[11px]"
                />
              </label>
            </div>
          )}

          {/* Apply button */}
          {sidebarMode === "logo" ? (
            <button
              onClick={() => get().addOperation(activeTool)}
              className="cap-btn-primary w-full mb-2"
            >
              Aplicar{" "}
              {activeTool === "blur"
                ? "Desenfoque"
                : activeTool === "crop"
                  ? "Recorte"
                  : activeTool === "delogo"
                    ? "Remover"
                    : activeTool === "image"
                      ? "Imagen"
                      : "Texto"}
            </button>
          ) : (
            <button
              onClick={() => get().addTemplateRegion()}
              disabled={!isRegionUsable(currentRegion)}
              className="cap-btn-primary w-full mb-2 disabled:opacity-50"
            >
              Agregar región de texto
            </button>
          )}
          <button
            onClick={() => get().setCurrentRegion(null)}
            className="text-[10px] hover:underline block mx-auto mb-3"
            style={{ color: "var(--text-muted)" }}
          >
            Cancelar selección
          </button>

          {/* Auto position buttons for text (normalized 0..1) */}
          {(activeTool === "text" || sidebarMode === "batch") && (
            <div className="mb-3">
              <div className="cap-input-label mb-1.5">Posición automática</div>
              <div className="grid grid-cols-5 gap-1 mb-1.5">
                {[
                  ["top-left", "↖", { x: 0.05, y: 0.05, w: 0.4, h: 0.08 }],
                  ["center", "⊕", { x: 0.3, y: 0.46, w: 0.4, h: 0.08 }],
                  ["top-right", "↗", { x: 0.55, y: 0.05, w: 0.4, h: 0.08 }],
                  ["bottom-left", "↙", { x: 0.05, y: 0.87, w: 0.4, h: 0.08 }],
                  ["bottom-right", "↘", { x: 0.55, y: 0.87, w: 0.4, h: 0.08 }],
                ].map(([pos, label, region]) => (
                  <button
                    key={pos}
                    onClick={() => get().setCurrentRegion(region)}
                    className="cap-btn-secondary !text-xs !p-1.5"
                    title={pos}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {!currentRegion && sidebarMode === "logo" && selectedOperation?.mode === "text" && (
        <AppliedTextEditor
          op={selectedOperation}
          video={sel}
          onPatch={(patch) => get().updateOperation(selectedIdx, selectedOperationIdx, patch)}
        />
      )}

      {!currentRegion && sidebarMode === "batch" && selectedTemplateRegion && (
        <AppliedTextEditor
          op={{
            mode: "text",
            text: selectedTemplateRegion.label,
            region: selectedTemplateRegion.region,
            ...(selectedTemplateRegion.style || {}),
          }}
          video={sel}
          title="Región aplicada"
          showContent={false}
          onPatch={(patch) => get().updateTemplateRegion(selectedTemplateRegion.id, patch)}
        />
      )}

      {/* Batch panel */}
      {sidebarMode === "batch" && <BatchPanel />}
    </div>
  );
}
