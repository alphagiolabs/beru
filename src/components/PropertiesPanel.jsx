import { shallow } from "zustand/shallow";
import useEditorStore from "../stores/useEditorStore";
import { useT } from "../i18n/useT";
import StyleEditor from "./StyleEditor";
import PresetManager from "./PresetManager";
import BatchPanel from "./BatchPanel";
import AppliedTextEditor from "./AppliedTextEditor";
import { isRegionUsable } from "../utils/video-utils";
import { DELOGO_METHODS, MIRROR_SIDES } from "../utils/types";
import { InspectorGroup, SegmentedControl } from "./inspector";
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
    textInput,
    tempStart,
    tempEnd,
  } = useEditorStore(
    (s) => ({
      selectedIdx: s.selectedIdx,
      sel: (() => {
        const item =
          s.selectedIdx >= 0 && s.selectedIdx < s.queue.length ? s.queue[s.selectedIdx] : null;
        if (!item) return null;
        return {
          path: item.path,
          src: item.src,
          filename: item.filename,
          width: item.width,
          height: item.height,
          duration: item.duration,
          operations: item.operations,
          customOutputName: item.customOutputName,
        };
      })(),
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
      // Subscribe to textInput/tempStart/tempEnd so the inputs re-render when
      // the store mutates externally (preset apply, undo, Excel reapply, project
      // load). Reading these via get() in JSX breaks reactivity — the input
      // shows a stale value while the store already has the new one.
      textInput: s.textInput,
      tempStart: s.tempStart,
      tempEnd: s.tempEnd,
    }),
    shallow,
  );
  const showToast = useEditorStore((s) => s.showToast);
  const get = useEditorStore.getState;
  const t = useT();

  return (
    <div className="inspector-panel">
      <div className="inspector-sticky-chrome">
        <SegmentedControl
          ariaLabel="Modo del panel"
          value={sidebarMode}
          onChange={(id) => get().setSidebarMode(id)}
          options={[
            { id: "logo", label: "Quitar logo", tone: "accent" },
            { id: "batch", label: "Texto en lote", tone: "purple" },
          ]}
        />
        <div className="inspector-chrome-meta">
          {sel?.filename ? (
            <>
              <span className="inspector-chrome-meta-key">Región</span>
              <span className="inspector-chrome-meta-value" title={sel.filename}>
                {sel.filename}
              </span>
            </>
          ) : (
            <span className="inspector-chrome-meta-empty">Sin video seleccionado</span>
          )}
        </div>
      </div>

      <div className="inspector-body">
        {!currentRegion &&
          !(sidebarMode === "logo" && selectedOperation?.mode === "text") &&
          !(sidebarMode === "batch" && selectedTemplateRegion) &&
          !(sidebarMode === "batch") && (
            <p className="inspector-empty">
              Dibuja una región en el video para editar propiedades.
            </p>
          )}

        {currentRegion && (
          <>
            <section className="inspector-region-strip" aria-label="Región">
              <div className="inspector-region-strip-head">
                <span className="inspector-region-strip-title">Región</span>
              </div>
              <div className="inspector-region-strip-fields" role="group">
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
                    <label key={key} className="inspector-region-cell">
                      <span className="inspector-region-cell-key">{label}</span>
                      <input
                        type="number"
                        inputMode="numeric"
                        aria-label={label}
                        value={Math.round((currentRegion[key] || 0) * (dimFor(key) || 1))}
                        onChange={(e) => {
                          const px = Number(e.target.value);
                          if (!Number.isFinite(px) || !dimFor(key)) return;
                          get().updateRegionValue(key, px / dimFor(key));
                        }}
                        className="inspector-region-cell-input"
                      />
                    </label>
                  ));
                })()}
              </div>
            </section>

            {sidebarMode === "batch" && (
              <div className="inspector-actions inspector-actions--region">
                <button
                  type="button"
                  onClick={() => get().addTemplateRegion()}
                  disabled={!isRegionUsable(currentRegion)}
                  className="cap-btn-primary w-full disabled:opacity-50"
                >
                  Agregar región de texto
                </button>
                <button
                  type="button"
                  onClick={() => get().cancelBatchRegionSelection()}
                  className="text-[11px] hover:underline block mx-auto"
                  style={{ color: "var(--text-muted)" }}
                >
                  Cancelar selección
                </button>
              </div>
            )}

            {sidebarMode === "logo" && activeTool === "image" && (
              <InspectorGroup title="Marca de agua">
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
                  className="flex items-center gap-2 text-[11px] min-w-0"
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
                    className="inspector-range"
                  />
                  <span
                    className="font-mono text-xs w-8 text-right"
                    style={{ color: "var(--accent-brand)" }}
                  >
                    {Math.round(tempImageOpacity * 100)}%
                  </span>
                </div>
                <div
                  className="flex items-center gap-2 text-[11px] min-w-0"
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
                    className="inspector-range"
                  />
                  <span
                    className="font-mono text-xs w-8 text-right"
                    style={{ color: "var(--accent-brand)" }}
                  >
                    {(tempImageScale || 1).toFixed(1)}x
                  </span>
                </div>
                <div>
                  <span className="cap-input-label">Posición rápida</span>
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
                        className="inspector-chip"
                        title={pos.label}
                      >
                        {pos.label}
                      </button>
                    ))}
                  </div>
                </div>
                <p className="inspector-helper text-center">
                  Arrastra el logo en el video para posicionarlo
                </p>
              </InspectorGroup>
            )}

            {sidebarMode === "logo" && activeTool === "blur" && (
              <InspectorGroup title="Desenfoque">
                <div
                  className="flex items-center gap-2 text-[11px] min-w-0"
                  style={{ color: "var(--text-dim)" }}
                >
                  Intensidad
                  <input
                    type="range"
                    min="2"
                    max="60"
                    value={blurStrength}
                    onChange={(e) => get().setBlurStrength(Number(e.target.value))}
                    className="inspector-range"
                  />
                  <span
                    className="font-mono text-xs w-6 text-right"
                    style={{ color: "var(--accent-brand)" }}
                  >
                    {blurStrength}
                  </span>
                </div>
              </InspectorGroup>
            )}

            {sidebarMode === "logo" && activeTool === "delogo" && (
              <InspectorGroup title="Eliminación de logo">
                <div className="flex items-center justify-between">
                  <span className="cap-input-label !mb-0">Método</span>
                  <span
                    className="flex items-center gap-1 text-[10px] font-medium"
                    style={{ color: "var(--rose)" }}
                    title="El resultado se muestra en vivo sobre el video"
                  >
                    <Eye size={10} /> Vista previa en vivo
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-1">
                  {DELOGO_METHODS.map((m) => {
                    const Icon = DELOGO_ICONS[m.id];
                    const active = delogoMethod === m.id;
                    return (
                      <button
                        key={m.id}
                        onClick={() => get().setDelogoMethod(m.id)}
                        className={`inspector-chip flex-col gap-0.5 !min-h-[40px]${active ? " is-selected" : ""}`}
                        style={
                          active
                            ? {
                                background: "var(--rose)",
                                color: "white",
                                borderColor: "var(--rose)",
                              }
                            : undefined
                        }
                        title={m.description}
                      >
                        {Icon && <Icon size={11} />}
                        <span className="text-[10px]">{m.label}</span>
                      </button>
                    );
                  })}
                </div>
                <p className="inspector-helper">
                  {DELOGO_METHODS.find((m) => m.id === delogoMethod)?.description}
                </p>

                {delogoMethod === "temporal" && (
                  <div
                    className="flex items-center gap-2 text-[11px] min-w-0"
                    style={{ color: "var(--text-dim)" }}
                  >
                    Radio (frames)
                    <input
                      type="range"
                      min="1"
                      max="15"
                      value={temporalRadius}
                      onChange={(e) => get().setTemporalRadius(e.target.value)}
                      className="inspector-range"
                    />
                    <span
                      className="font-mono text-xs w-6 text-right"
                      style={{ color: "var(--accent-brand)" }}
                    >
                      {temporalRadius}
                    </span>
                  </div>
                )}

                {delogoMethod === "mosaic" && (
                  <div
                    className="flex items-center gap-2 text-[11px] min-w-0"
                    style={{ color: "var(--text-dim)" }}
                  >
                    Tamaño bloque
                    <input
                      type="range"
                      min="4"
                      max="40"
                      value={mosaicSize}
                      onChange={(e) => get().setMosaicSize(e.target.value)}
                      className="inspector-range"
                    />
                    <span
                      className="font-mono text-xs w-6 text-right"
                      style={{ color: "var(--accent-brand)" }}
                    >
                      {mosaicSize}px
                    </span>
                  </div>
                )}

                {delogoMethod === "mirror" && (
                  <div>
                    <span className="cap-input-label">Lado a reflejar</span>
                    <div className="grid grid-cols-2 gap-1">
                      {MIRROR_SIDES.map((s) => (
                        <button
                          key={s.id}
                          onClick={() => get().setMirrorSide(s.id)}
                          className={`inspector-chip${mirrorSide === s.id ? " is-selected" : ""}`}
                          style={
                            mirrorSide === s.id
                              ? {
                                  background: "var(--rose)",
                                  color: "white",
                                  borderColor: "var(--rose)",
                                }
                              : undefined
                          }
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {delogoMethod === "blur" && (
                  <div
                    className="flex items-center gap-2 text-[11px] min-w-0"
                    style={{ color: "var(--text-dim)" }}
                  >
                    Intensidad blur
                    <input
                      type="range"
                      min="2"
                      max="60"
                      value={blurStrength}
                      onChange={(e) => get().setBlurStrength(Number(e.target.value))}
                      className="inspector-range"
                    />
                    <span
                      className="font-mono text-xs w-6 text-right"
                      style={{ color: "var(--accent-brand)" }}
                    >
                      {blurStrength}
                    </span>
                  </div>
                )}

                {delogoMethod === "fill" && (
                  <div className="space-y-2">
                    <label className="flex items-center gap-2">
                      <span className="cap-input-label !mb-0">Color</span>
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
                      className="flex items-center gap-2 text-[11px] min-w-0"
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
                        className="inspector-range"
                      />
                      <span
                        className="font-mono text-xs w-6 text-right"
                        style={{ color: "var(--accent-brand)" }}
                      >
                        {delogoFillOpacity.toFixed(2)}
                      </span>
                    </div>
                  </div>
                )}

                {delogoMethod === "cover" && (
                  <div>
                    <span className="cap-input-label">Imagen de cobertura</span>
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
                            const r = await window.api?.readImage(res.path);
                            if (r?.success) {
                              get().cacheImageData(res.path, r.dataUrl);
                            }
                          } else if (res && !res.canceled) {
                            get().showToast({
                              kind: "err",
                              text: res.error || "No se pudo cargar la imagen",
                            });
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
                      <p className="inspector-helper mt-1" style={{ color: "var(--rose)" }}>
                        Selecciona una imagen o el método caerá a “Temporal”.
                      </p>
                    )}
                  </div>
                )}

                <div
                  className="flex items-center gap-2 text-[11px] pt-1 min-w-0"
                  style={{ color: "var(--text-dim)" }}
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
                    className="inspector-range"
                  />
                  <span
                    className="font-mono text-xs w-8 text-right"
                    style={{ color: "var(--accent-brand)" }}
                  >
                    {edgeFeather}px
                  </span>
                </div>
              </InspectorGroup>
            )}

            {(activeTool === "text" || sidebarMode === "batch") && (
              <div className="space-y-2.5">
                {sidebarMode === "logo" && (
                  <InspectorGroup title="Contenido">
                    <input
                      type="text"
                      value={textInput}
                      onChange={(e) => get().setTextInput(e.target.value)}
                      placeholder="Texto..."
                      className="cap-input"
                    />
                  </InspectorGroup>
                )}
                <StyleEditor />
                <InspectorGroup title="Posición automática" className="inspector-group--auto-pos">
                  <div className="inspector-auto-pos" role="group" aria-label="Posición automática">
                    {[
                      ["top-left", "↖", { x: 0.05, y: 0.05, w: 0.4, h: 0.08 }],
                      ["center", "⊕", { x: 0.3, y: 0.46, w: 0.4, h: 0.08 }],
                      ["top-right", "↗", { x: 0.55, y: 0.05, w: 0.4, h: 0.08 }],
                      ["bottom-left", "↙", { x: 0.05, y: 0.87, w: 0.4, h: 0.08 }],
                      ["bottom-right", "↘", { x: 0.55, y: 0.87, w: 0.4, h: 0.08 }],
                    ].map(([pos, label, region]) => (
                      <button
                        key={pos}
                        type="button"
                        onClick={() => get().setCurrentRegion(region)}
                        className="inspector-auto-pos-btn"
                        title={pos}
                        aria-label={pos}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </InspectorGroup>
                <PresetManager />
              </div>
            )}

            {sidebarMode === "logo" && (
              <InspectorGroup title="Rango temporal">
                <div className="grid grid-cols-2 gap-2">
                  <label>
                    <span className="cap-input-label">Inicio (s)</span>
                    <input
                      type="number"
                      value={tempStart ?? ""}
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
                      value={tempEnd ?? ""}
                      onChange={(e) =>
                        get().setTempEnd(e.target.value ? Number(e.target.value) : null)
                      }
                      placeholder="final"
                      className="cap-input font-mono text-[11px]"
                    />
                  </label>
                </div>
                {tempStart != null && tempEnd != null && tempEnd <= tempStart && (
                  <div
                    className="cap-card text-[11px] leading-relaxed"
                    style={{ color: "#ef4444", borderColor: "rgba(239,68,68,0.3)" }}
                  >
                    El rango es inválido (Fin ≤ Inicio). La operación no se aplicará en la
                    exportación. Ajusta Fin para que sea mayor que Inicio.
                  </div>
                )}
              </InspectorGroup>
            )}

            {sidebarMode === "logo" && (
              <div className="inspector-actions">
                <button
                  type="button"
                  onClick={() => get().addOperation(activeTool)}
                  className="cap-btn-primary w-full"
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
                <button
                  type="button"
                  onClick={() => get().setCurrentRegion(null)}
                  className="text-[11px] hover:underline block mx-auto"
                  style={{ color: "var(--text-muted)" }}
                >
                  Cancelar selección
                </button>
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

        {sidebarMode === "batch" && <BatchPanel />}
      </div>
    </div>
  );
}
