import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { X, Play, Pause, SkipBack, SkipForward, Bold, Italic, Trash2, Plus, FileVideo, Layers, AlignLeft, AlignCenter, AlignRight, Crosshair, Move } from "lucide-react";
import useEditorStore from "../stores/useEditorStore";
import { regionToScreen, fmtTime, clampRegionToVideo } from "../utils/video-utils";
import { FONT_FAMILIES, FONT_WEIGHTS, TEXT_ALIGNS } from "../utils/types";

function findOpForRegion(operations, region) {
  if (!region) return { op: null, opIdx: -1 };
  const idx = operations.findIndex(
    (o) => o.mode === "text" && o.region &&
      Math.abs(o.region.x - region.x) < 0.001 &&
      Math.abs(o.region.y - region.y) < 0.001
  );
  return { op: idx >= 0 ? operations[idx] : null, opIdx: idx };
}

const NAMED_COLORS = {
  white: "#ffffff", black: "#000000", red: "#ff0000", green: "#008000",
  blue: "#0000ff", yellow: "#ffff00", cyan: "#00ffff", magenta: "#ff00ff",
  gray: "#808080", grey: "#808080", silver: "#c0c0c0", maroon: "#800000",
  olive: "#808000", purple: "#800080", teal: "#008080", navy: "#000080",
  orange: "#ffa500", pink: "#ffc0cb", brown: "#a52a2a", lime: "#00ff00",
  aqua: "#00ffff", fuchsia: "#ff00ff",
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

export default function TableEditor() {
  const store = useEditorStore();
  const {
    showTableEditor, queue, templateRegions,
    excelPath, excelMapping, excelRows, excelMatchStatus,
  } = store;
  const [focused, setFocused] = useState({ videoIdx: 0, regionId: null });
  const [editingCell, setEditingCell] = useState(null);
  const [editValue, setEditValue] = useState("");
  const videoRef = useRef(null);
  const tableRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [seeking, setSeeking] = useState(false);

  useEffect(() => {
    if (showTableEditor) {
      setFocused({ videoIdx: 0, regionId: templateRegions[0]?.id ?? null });
      setEditingCell(null);
      setPlaying(false);
    }
  }, [showTableEditor, templateRegions.length]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTimeUpdate = () => { if (!seeking) setCurrentTime(v.currentTime); };
    const onLoadedMeta = () => setDuration(v.duration);
    const onEnded = () => setPlaying(false);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("timeupdate", onTimeUpdate);
    v.addEventListener("loadedmetadata", onLoadedMeta);
    v.addEventListener("ended", onEnded);
    return () => {
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("timeupdate", onTimeUpdate);
      v.removeEventListener("loadedmetadata", onLoadedMeta);
      v.removeEventListener("ended", onEnded);
    };
  }, [focused.videoIdx, seeking]);

  useEffect(() => {
    setPlaying(false);
    setCurrentTime(0);
    setDuration(queue[focused.videoIdx]?.duration || 0);
  }, [focused.videoIdx]);

  const seekTo = useCallback((fraction) => {
    const v = videoRef.current;
    if (v && duration > 0) v.currentTime = fraction * duration;
  }, [duration]);

  const startInlineEdit = (videoIdx, regionId, currentText) => {
    setEditingCell({ videoIdx, regionId });
    setEditValue(currentText || "");
  };

  const commitInlineEdit = () => {
    if (!editingCell) return;
    const { videoIdx, regionId } = editingCell;
    const video = queue[videoIdx];
    const region = templateRegions.find((r) => r.id === regionId);
    if (!video || !region) { setEditingCell(null); return; }
    const { op, opIdx } = findOpForRegion(video.operations, region.region);
    if (op) {
      store.updateOperationText(videoIdx, opIdx, editValue);
    } else if (editValue.length > 0) {
      const newIdx = store.createTextOpForRegion(videoIdx, regionId);
      if (newIdx >= 0) store.updateOperationText(videoIdx, newIdx, editValue);
    } else {
      store.syncTextToExcel(videoIdx, regionId, "");
    }
    setEditingCell(null);
  };

  const cancelInlineEdit = () => setEditingCell(null);

  const moveFocus = (deltaRow, deltaCol) => {
    if (queue.length === 0 || templateRegions.length === 0) return;
    setFocused((f) => {
      const vCount = queue.length;
      const cCount = templateRegions.length;
      const curCol = f.regionId == null ? 0 : Math.max(0, templateRegions.findIndex((r) => r.id === f.regionId));
      const newCol = Math.max(0, Math.min(cCount - 1, curCol + deltaCol));
      const newRow = Math.max(0, Math.min(vCount - 1, f.videoIdx + deltaRow));
      return { videoIdx: newRow, regionId: templateRegions[newCol]?.id ?? null };
    });
  };

  const handleTableKey = (e) => {
    if (editingCell) {
      if (e.key === "Enter") { e.preventDefault(); commitInlineEdit(); }
      else if (e.key === "Escape") { e.preventDefault(); cancelInlineEdit(); }
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); moveFocus(1, 0); }
    else if (e.key === "ArrowUp") { e.preventDefault(); moveFocus(-1, 0); }
    else if (e.key === "ArrowRight") { e.preventDefault(); moveFocus(0, 1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); moveFocus(0, -1); }
    else if (e.key === "Enter" || e.key === "F2") {
      e.preventDefault();
      const region = templateRegions.find((r) => r.id === focused.regionId);
      const video = queue[focused.videoIdx];
      if (!region || !video) return;
      startInlineEdit(
        focused.videoIdx,
        focused.regionId,
        store.getCellTextForRegion(focused.videoIdx, focused.regionId)
      );
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      const region = templateRegions.find((r) => r.id === focused.regionId);
      const video = queue[focused.videoIdx];
      if (!region || !video) return;
      const { opIdx } = findOpForRegion(video.operations, region.region);
      if (opIdx >= 0) store.removeOperationAt(focused.videoIdx, opIdx);
    } else if (e.key === "Escape") {
      e.preventDefault();
      store.setShowTableEditor(false);
    }
  };

  if (!showTableEditor || queue.length === 0) return null;

  const focusedVideo = queue[focused.videoIdx];
  const focusedRegion = templateRegions.find((r) => r.id === focused.regionId);
  const { op: focusedOp, opIdx: focusedOpIdx } = findOpForRegion(
    focusedVideo?.operations || [],
    focusedRegion?.region
  );

  const updateFocused = (patch) => {
    if (focusedOpIdx < 0) return;
    store.updateOperation(focused.videoIdx, focusedOpIdx, patch);
  };

  const createFocusedOp = () => {
    if (!focusedRegion) return;
    const newIdx = store.createTextOpForRegion(focused.videoIdx, focused.regionId);
    if (newIdx >= 0 && editValue) {
      store.updateOperationText(focused.videoIdx, newIdx, editValue);
    }
  };

  const deleteFocusedOp = () => {
    if (focusedOpIdx < 0) return;
    store.removeOperationAt(focused.videoIdx, focusedOpIdx);
  };

  const seekFrac = duration > 0 ? currentTime / duration : 0;
  const hasRegions = templateRegions.length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.75)" }}
      onClick={() => store.setShowTableEditor(false)}
    >
      <div
        className="w-[95vw] max-w-[1200px] max-h-[90vh] flex flex-col rounded-lg shadow-2xl overflow-hidden"
        style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0" style={{ borderColor: "var(--border)" }}>
          <div className="flex items-center gap-2">
            <Layers size={16} style={{ color: "var(--purple)" }} />
            <span className="text-sm font-semibold">Editor de tabla</span>
            <span className="text-[10px]" style={{ color: "var(--text-dim)" }}>
              {queue.length} videos · {templateRegions.length} regiones
              {excelPath && excelRows.length > 0 && (
                <> · Excel ({excelRows.length} filas{excelMapping.idColumn ? `, ID: ${excelMapping.idColumn}` : ""})</>
              )}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[10px]" style={{ color: "var(--text-dim)" }}>
              ↑↓←→ navegar · Enter editar · Del eliminar · Esc cerrar
            </span>
            <button
              onClick={() => store.setShowTableEditor(false)}
              className="p-1 rounded hover:bg-white/10"
              style={{ color: "var(--text-dim)" }}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Top section: Preview + Editing row */}
        <div className="flex flex-1 min-h-0 border-b" style={{ borderColor: "var(--border)" }}>
          {/* Preview */}
          <div className="flex-1 flex flex-col p-3 min-w-0">
            <div className="text-[10px] font-semibold tracking-widest uppercase mb-2" style={{ color: "var(--text-dim)" }}>
              Vista previa
            </div>
            <div className="flex-1 flex items-center justify-center min-h-0 rounded overflow-hidden" style={{ background: "#000" }}>
              {focusedVideo ? (
                <div className="relative inline-block" style={{ maxWidth: "100%", maxHeight: "100%" }}>
                  <video
                    ref={videoRef}
                    src={focusedVideo.src}
                    className="max-h-full max-w-full block object-contain"
                    style={{ maxHeight: "calc(90vh - 380px)" }}
                  />
                  {focusedVideo.operations.map((op) => {
                    const s = regionToScreen(op.region, videoRef.current);
                    if (!s || !op.text) return null;
                    const isFocused = focusedOp && op.id === focusedOp.id;
                    const fontSize = Math.max(1, (op.fontSize || 24) * s.sy);
                    const bgOn = op.bgEnabled !== false;
                    const baseWeight = op.fontWeight ?? (op.bold ? 700 : 400);
                    const letterSpacing = (op.letterSpacing || 0) * s.sy;
                    const textOpacity = op.textOpacity ?? 1;
                    const align = op.textAlign || "left";
                    const boxPad = bgOn ? Math.max(2, (op.boxBorderWidth || 4) * s.sy) : 0;
                    return (
                      <div
                        key={op.id}
                        className="absolute pointer-events-none"
                        style={{
                          left: s.x, top: s.y, width: s.w, height: s.h,
                          outline: isFocused ? "2px solid var(--accent)" : "1px dashed rgba(168,85,247,0.4)",
                          outlineOffset: "1px",
                        }}
                      >
                        {bgOn && (
                          <div style={{
                            position: "absolute", inset: 0,
                            background: op.bgColor || "black",
                            opacity: op.bgOpacity ?? 0.65,
                            borderRadius: `${Math.max(3, 6 * s.sy)}px`,
                          }} />
                        )}
                        <div style={{
                          position: "relative",
                          color: op.fontColor || "white",
                          opacity: textOpacity,
                          fontSize: `${fontSize}px`,
                          fontFamily: `"${op.fontFamily || "Arial"}", sans-serif`,
                          fontWeight: baseWeight,
                          fontStyle: op.italic ? "italic" : "normal",
                          letterSpacing: `${letterSpacing}px`,
                          textAlign: align,
                          padding: `${boxPad}px`,
                          whiteSpace: "pre-wrap",
                          WebkitTextStroke: op.borderWidth > 0 ? `${op.borderWidth * s.sy}px ${op.borderColor || "black"}` : "none",
                        }}>{op.text}</div>
                      </div>
                    );
                  })}
                  {/* Focused region outline (when no op yet) */}
                  {!focusedOp && focusedRegion && (() => {
                    const s = regionToScreen(focusedRegion.region, videoRef.current);
                    if (!s) return null;
                    return (
                      <div className="absolute pointer-events-none" style={{
                        left: s.x, top: s.y, width: s.w, height: s.h,
                        outline: "2px dashed var(--accent)",
                        background: "rgba(255,255,255,0.04)",
                      }}>
                        <div style={{
                          position: "absolute", top: -18, left: 0,
                          background: "var(--accent)", color: "var(--bg-app)",
                          fontSize: "9px", fontWeight: 600,
                          padding: "1px 6px", borderRadius: "3px 3px 0 0",
                          whiteSpace: "nowrap",
                        }}>{focusedRegion.label} (vacío)</div>
                      </div>
                    );
                  })()}
                </div>
              ) : (
                <div className="text-[11px]" style={{ color: "var(--text-dim)" }}>Sin video</div>
              )}
            </div>
            {/* Preview controls */}
            {focusedVideo && (
              <div className="mt-2 flex-shrink-0">
                <input
                  type="range" min={0} max={1} step={0.001}
                  value={seekFrac}
                  onMouseDown={() => setSeeking(true)}
                  onMouseUp={() => setSeeking(false)}
                  onChange={(e) => {
                    const frac = parseFloat(e.target.value);
                    setCurrentTime(frac * duration);
                    seekTo(frac);
                  }}
                  className="w-full h-1 rounded-full appearance-none cursor-pointer mb-1"
                  style={{
                    accentColor: "var(--accent)",
                    background: `linear-gradient(to right, var(--accent) ${seekFrac * 100}%, var(--border) ${seekFrac * 100}%)`,
                  }}
                />
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { const v = videoRef.current; if (v) v.currentTime = 0; }}
                    className="p-1 rounded hover:bg-white/10"
                    style={{ color: "var(--text-dim)" }}
                  >
                    <SkipBack size={12} />
                  </button>
                  <button
                    onClick={() => { const v = videoRef.current; if (!v) return; v.paused ? v.play() : v.pause(); }}
                    className="p-1.5 rounded-full hover:bg-white/15"
                    style={{ color: "var(--accent)" }}
                  >
                    {playing ? <Pause size={14} /> : <Play size={14} />}
                  </button>
                  <button
                    onClick={() => { const v = videoRef.current; if (v && v.duration) v.currentTime = v.duration; }}
                    className="p-1 rounded hover:bg-white/10"
                    style={{ color: "var(--text-dim)" }}
                  >
                    <SkipForward size={12} />
                  </button>
                  <span className="text-[10px] font-mono" style={{ color: "var(--text-secondary)" }}>
                    {fmtTime(currentTime)} / {fmtTime(duration)}
                  </span>
                  <div className="flex-1" />
                  <span className="text-[10px] truncate max-w-[180px]" style={{ color: "var(--text-dim)" }} title={focusedVideo.filename}>
                    <FileVideo size={10} className="inline mr-1" />
                    {focusedVideo.filename}
                  </span>
                  {focusedVideo.width > 0 && (
                    <span className="text-[10px] font-mono" style={{ color: "var(--text-dim)" }}>
                      {focusedVideo.width}×{focusedVideo.height}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Editing row */}
          <div className="w-[360px] flex-shrink-0 flex flex-col border-l overflow-hidden" style={{ borderColor: "var(--border)" }}>
            <div className="px-3 py-2 border-b flex items-center justify-between" style={{ borderColor: "var(--border)" }}>
              <div className="text-[10px] font-semibold tracking-widest uppercase" style={{ color: "var(--text-dim)" }}>
                Fila de edición
              </div>
              {focusedVideo && (
                <span className="text-[10px] font-mono" style={{ color: "var(--text-dim)" }}>
                  V{focused.videoIdx + 1}/{queue.length}
                  {focusedRegion && ` · ${focusedRegion.label}`}
                </span>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {!hasRegions ? (
                <div className="text-[11px] leading-relaxed p-3 rounded" style={{ background: "var(--bg-surface)", color: "var(--text-secondary)" }}>
                  No hay regiones de plantilla. Dibuja una región en el video y agrégala desde el panel "Texto en lote".
                </div>
              ) : !focusedRegion ? (
                <div className="text-[11px] leading-relaxed p-3 rounded" style={{ background: "var(--bg-surface)", color: "var(--text-secondary)" }}>
                  Selecciona una celda de la tabla para editar.
                </div>
              ) : (
                <>
                  {/* Cell status */}
                  <div className="flex items-center justify-between gap-2 p-2 rounded" style={{
                    background: focusedOp ? "rgba(168,85,247,0.1)" : "rgba(255,255,255,0.04)",
                    border: `1px solid ${focusedOp ? "rgba(168,85,247,0.4)" : "var(--border)"}`,
                  }}>
                    <span className="text-[10px] font-mono" style={{ color: focusedOp ? "var(--purple)" : "var(--text-dim)" }}>
                      {focusedOp ? "● Operación activa" : "○ Celda vacía"}
                    </span>
                    {!focusedOp && (
                      <button onClick={createFocusedOp} className="cap-btn-primary !text-[10px] !py-0.5 !px-2">
                        <Plus size={10} /> Crear
                      </button>
                    )}
                  </div>

                  {/* Text content */}
                  <label>
                    <span className="cap-input-label">Contenido</span>
                    <textarea
                      value={focusedOp?.text ?? ""}
                      onChange={(e) => updateFocused({ text: e.target.value })}
                      disabled={!focusedOp}
                      placeholder="Texto del overlay..."
                      rows={2}
                      className="cap-input text-[11px] resize-y"
                      style={{ fontFamily: `"${focusedOp?.fontFamily || "Arial"}", sans-serif` }}
                    />
                  </label>

                  {/* Alignment */}
                  <div>
                    <span className="cap-input-label">Alineación</span>
                    <div className="grid grid-cols-3 gap-1">
                      {TEXT_ALIGNS.map((a) => {
                        const active = (focusedOp?.textAlign || "left") === a.value;
                        return (
                          <button
                            key={a.value}
                            onClick={() => focusedOp && updateFocused({ textAlign: a.value })}
                            disabled={!focusedOp}
                            className="cap-btn-secondary !text-[10px] !py-1"
                            style={active ? { background: "var(--accent)", color: "var(--bg-app)", borderColor: "var(--accent)" } : {}}
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

                  {/* Typography */}
                  <div>
                    <span className="cap-input-label">Tipografía</span>
                    <label className="block mb-1.5">
                      <select
                        value={focusedOp?.fontFamily || "Arial"}
                        onChange={(e) => updateFocused({ fontFamily: e.target.value })}
                        disabled={!focusedOp}
                        className="cap-input text-[11px]"
                      >
                        {FONT_FAMILIES.map((f) => <option key={f} value={f}>{f}</option>)}
                      </select>
                    </label>
                    <div className="grid grid-cols-7 gap-0.5 mb-1.5">
                      {FONT_WEIGHTS.map((w) => {
                        const active = (focusedOp?.fontWeight ?? 400) === w.value;
                        return (
                          <button
                            key={w.value}
                            onClick={() => focusedOp && updateFocused({ fontWeight: w.value, bold: w.value >= 700 })}
                            disabled={!focusedOp}
                            className="cap-btn-secondary !text-[9px] !px-0 !py-1.5"
                            style={{
                              ...(active ? { background: "var(--accent)", color: "var(--bg-app)", borderColor: "var(--accent)" } : {}),
                              fontWeight: w.value,
                            }}
                            title={w.label}
                          >
                            Aa
                          </button>
                        );
                      })}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] w-[60px]" style={{ color: "var(--text-dim)" }}>Tamaño</span>
                      <input
                        type="range"
                        min={8}
                        max={200}
                        value={focusedOp?.fontSize ?? 32}
                        onChange={(e) => updateFocused({ fontSize: Number(e.target.value) })}
                        disabled={!focusedOp}
                        className="flex-1"
                        style={{ accentColor: "var(--accent)" }}
                      />
                      <input
                        type="number"
                        value={focusedOp?.fontSize ?? 32}
                        onChange={(e) => updateFocused({ fontSize: Number(e.target.value) })}
                        disabled={!focusedOp}
                        min={8}
                        max={400}
                        className="cap-input font-mono text-[10px] !py-0.5 w-[52px] text-center"
                      />
                    </div>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className="text-[9px] w-[60px]" style={{ color: "var(--text-dim)" }}>Espaciado</span>
                      <input
                        type="range"
                        min={-5}
                        max={30}
                        value={focusedOp?.letterSpacing ?? 0}
                        onChange={(e) => updateFocused({ letterSpacing: Number(e.target.value) })}
                        disabled={!focusedOp}
                        className="flex-1"
                        style={{ accentColor: "var(--accent)" }}
                      />
                      <input
                        type="number"
                        value={focusedOp?.letterSpacing ?? 0}
                        onChange={(e) => updateFocused({ letterSpacing: Number(e.target.value) })}
                        disabled={!focusedOp}
                        min={-20}
                        max={60}
                        step={0.5}
                        className="cap-input font-mono text-[10px] !py-0.5 w-[52px] text-center"
                      />
                    </div>
                  </div>

                  {/* Color */}
                  <div className="border-t pt-2" style={{ borderColor: "var(--border)" }}>
                    <span className="cap-input-label">Color</span>
                    <div className="grid grid-cols-[1fr_auto] gap-1.5 mb-1.5">
                      <div className="flex gap-1">
                        <input
                          type="color"
                          value={normalizeColor(focusedOp?.fontColor) || "#ffffff"}
                          onChange={(e) => updateFocused({ fontColor: e.target.value })}
                          disabled={!focusedOp}
                          className="w-7 h-7 rounded border-0 p-0 cursor-pointer flex-shrink-0"
                        />
                        <input
                          type="text"
                          value={focusedOp?.fontColor || "#ffffff"}
                          onChange={(e) => updateFocused({ fontColor: e.target.value })}
                          disabled={!focusedOp}
                          className="cap-input flex-1 font-mono text-[10px]"
                        />
                      </div>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          value={Math.round((focusedOp?.textOpacity ?? 1) * 100)}
                          onChange={(e) => updateFocused({ textOpacity: Math.max(0, Math.min(100, Number(e.target.value))) / 100 })}
                          disabled={!focusedOp}
                          min={0}
                          max={100}
                          step={5}
                          className="cap-input font-mono text-[10px] !py-0.5 w-[44px] text-center"
                        />
                        <span className="text-[9px]" style={{ color: "var(--text-dim)" }}>%</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] w-[60px]" style={{ color: "var(--text-dim)" }}>Opacidad</span>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={focusedOp?.textOpacity ?? 1}
                        onChange={(e) => updateFocused({ textOpacity: parseFloat(e.target.value) })}
                        disabled={!focusedOp}
                        className="flex-1"
                        style={{ accentColor: "var(--accent)" }}
                      />
                    </div>
                    {/* Color presets */}
                    <div className="flex gap-1 mt-1.5">
                      {["#ffffff", "#000000", "#fbbf24", "#f43f5e", "#22c55e", "#3b82f6", "#a855f7", "#f97316"].map((c) => {
                        const active = (focusedOp?.fontColor || "").toLowerCase() === c;
                        return (
                          <button
                            key={c}
                            onClick={() => focusedOp && updateFocused({ fontColor: c })}
                            disabled={!focusedOp}
                            className="w-5 h-5 rounded border"
                            style={{
                              background: c,
                              borderColor: active ? "var(--accent)" : "var(--border)",
                              boxShadow: active ? "0 0 0 1px var(--accent)" : "none",
                            }}
                            title={c}
                          />
                        );
                      })}
                    </div>
                  </div>

                  {/* Background */}
                  <div className="border-t pt-2" style={{ borderColor: "var(--border)" }}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="cap-input-label !mb-0">Fondo</span>
                      <label className="flex items-center gap-1.5 text-[10px] cursor-pointer" style={{ color: "var(--text-dim)" }}>
                        <input
                          type="checkbox"
                          checked={focusedOp?.bgEnabled !== false}
                          onChange={(e) => updateFocused({ bgEnabled: e.target.checked })}
                          disabled={!focusedOp}
                        />
                        activo
                      </label>
                    </div>
                    {focusedOp?.bgEnabled !== false && focusedOp && (
                      <>
                        <div className="grid grid-cols-[1fr_auto] gap-1.5 mb-1.5">
                          <div className="flex gap-1">
                            <input
                              type="color"
                              value={normalizeColor(focusedOp.bgColor) || "#000000"}
                              onChange={(e) => updateFocused({ bgColor: e.target.value })}
                              className="w-6 h-6 rounded border-0 p-0 cursor-pointer flex-shrink-0"
                            />
                            <input
                              type="text"
                              value={focusedOp.bgColor || "#000000"}
                              onChange={(e) => updateFocused({ bgColor: e.target.value })}
                              className="cap-input flex-1 font-mono text-[10px]"
                            />
                          </div>
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              value={Math.round((focusedOp.bgOpacity ?? 0.65) * 100)}
                              onChange={(e) => updateFocused({ bgOpacity: Math.max(0, Math.min(100, Number(e.target.value))) / 100 })}
                              min={0}
                              max={100}
                              step={5}
                              className="cap-input font-mono text-[10px] !py-0.5 w-[44px] text-center"
                            />
                            <span className="text-[9px]" style={{ color: "var(--text-dim)" }}>%</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="text-[9px] w-[60px]" style={{ color: "var(--text-dim)" }}>Opacidad</span>
                          <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.05}
                            value={focusedOp.bgOpacity ?? 0.65}
                            onChange={(e) => updateFocused({ bgOpacity: parseFloat(e.target.value) })}
                            className="flex-1"
                            style={{ accentColor: "var(--accent)" }}
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[9px] w-[60px]" style={{ color: "var(--text-dim)" }}>Padding</span>
                          <input
                            type="range"
                            min={0}
                            max={40}
                            value={focusedOp.boxBorderWidth ?? 4}
                            onChange={(e) => updateFocused({ boxBorderWidth: Number(e.target.value) })}
                            className="flex-1"
                            style={{ accentColor: "var(--accent)" }}
                          />
                          <input
                            type="number"
                            value={focusedOp.boxBorderWidth ?? 4}
                            onChange={(e) => updateFocused({ boxBorderWidth: Number(e.target.value) })}
                            min={0}
                            max={80}
                            className="cap-input font-mono text-[10px] !py-0.5 w-[44px] text-center"
                          />
                        </div>
                      </>
                    )}
                  </div>

                  {/* Text border (stroke) */}
                  <div className="border-t pt-2" style={{ borderColor: "var(--border)" }}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="cap-input-label !mb-0">Borde (stroke)</span>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => focusedOp && updateFocused({ bold: !focusedOp.bold })}
                          disabled={!focusedOp}
                          className="cap-btn-secondary !px-1.5 !py-0.5"
                          style={focusedOp?.bold ? { background: "var(--accent)", color: "var(--bg-app)", borderColor: "var(--accent)" } : {}}
                          title="Bold"
                        >
                          <Bold size={10} />
                        </button>
                        <button
                          onClick={() => focusedOp && updateFocused({ italic: !focusedOp.italic })}
                          disabled={!focusedOp}
                          className="cap-btn-secondary !px-1.5 !py-0.5"
                          style={focusedOp?.italic ? { background: "var(--accent)", color: "var(--bg-app)", borderColor: "var(--accent)" } : {}}
                          title="Italic"
                        >
                          <Italic size={10} />
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-[auto_1fr] gap-1.5">
                      <input
                        type="number"
                        value={focusedOp?.borderWidth ?? 0}
                        onChange={(e) => updateFocused({ borderWidth: Number(e.target.value) })}
                        disabled={!focusedOp}
                        min={0}
                        max={20}
                        className="cap-input font-mono text-[10px] !py-0.5 w-[48px] text-center"
                      />
                      <div className="flex gap-1">
                        <input
                          type="color"
                          value={normalizeColor(focusedOp?.borderColor) || "#000000"}
                          onChange={(e) => updateFocused({ borderColor: e.target.value })}
                          disabled={!focusedOp}
                          className="w-6 h-6 rounded border-0 p-0 cursor-pointer flex-shrink-0"
                        />
                        <input
                          type="text"
                          value={focusedOp?.borderColor || "#000000"}
                          onChange={(e) => updateFocused({ borderColor: e.target.value })}
                          disabled={!focusedOp}
                          className="cap-input flex-1 font-mono text-[10px]"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Position */}
                  {focusedOp?.region && (
                    <div className="border-t pt-2" style={{ borderColor: "var(--border)" }}>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="cap-input-label !mb-0">Posición</span>
                        <span className="text-[9px] font-mono" style={{ color: "var(--text-dim)" }}>
                          {Math.round(focusedOp.region.x * (focusedVideo?.width || 1))},{Math.round(focusedOp.region.y * (focusedVideo?.height || 1))} {Math.round(focusedOp.region.w * (focusedVideo?.width || 1))}×{Math.round(focusedOp.region.h * (focusedVideo?.height || 1))}
                          {focusedVideo?.width > 0 && (
                            <span style={{ color: "var(--text-muted)" }}>
                              {" "}({Math.round(focusedOp.region.x * 100)}%, {Math.round(focusedOp.region.y * 100)}%)
                            </span>
                          )}
                        </span>
                      </div>

                      {/* Mini position map */}
                      {focusedVideo?.width > 0 && focusedVideo?.height > 0 && (
                        <div className="relative mx-auto mb-2 rounded overflow-hidden" style={{
                          aspectRatio: `${focusedVideo.width} / ${focusedVideo.height}`,
                          maxWidth: "100%",
                          maxHeight: "90px",
                          background: "var(--bg-app)",
                          border: "1px solid var(--border)",
                        }}>
                          <div style={{
                            position: "absolute",
                            left: `${focusedOp.region.x * 100}%`,
                            top: `${focusedOp.region.y * 100}%`,
                            width: `${focusedOp.region.w * 100}%`,
                            height: `${focusedOp.region.h * 100}%`,
                            background: "rgba(168,85,247,0.25)",
                            border: "1px solid var(--purple)",
                            borderRadius: "2px",
                            boxShadow: "0 0 0 1px rgba(0,0,0,0.5)",
                          }} />
                        </div>
                      )}

                      {/* Position presets (normalized 0..1) */}
                      <div className="flex gap-1 mb-2">
                        {[
                          { id: "tl", label: "↖", x: 0.05, y: 0.05 },
                          { id: "tc", label: "↑", x: 0.30, y: 0.05 },
                          { id: "tr", label: "↗", x: 0.55, y: 0.05 },
                          { id: "ml", label: "←", x: 0.05, y: 0.45 },
                          { id: "cc", label: "⊕", x: 0.30, y: 0.45 },
                          { id: "mr", label: "→", x: 0.55, y: 0.45 },
                          { id: "bl", label: "↙", x: 0.05, y: 0.85 },
                          { id: "bc", label: "↓", x: 0.30, y: 0.85 },
                          { id: "br", label: "↘", x: 0.55, y: 0.85 },
                        ].map((p) => {
                          const w = focusedOp.region.w;
                          const h = focusedOp.region.h;
                          return (
                            <button
                              key={p.id}
                              onClick={() => updateFocused({
                                region: clampRegionToVideo({
                                  x: p.x,
                                  y: p.y,
                                  w, h,
                                }),
                              })}
                              className="cap-btn-secondary !text-[10px] !px-0 !py-0.5 flex-1"
                              title={p.id}
                            >
                              {p.label}
                            </button>
                          );
                        })}
                      </div>

                      {/* X/Y/W/H inputs + nudges (display in pixels) */}
                      <div className="space-y-1.5">
                        {[["X", "x"], ["Y", "y"], ["W", "w"], ["H", "h"]].map(([label, key]) => {
                          const vw = focusedVideo?.width || 0;
                          const vh = focusedVideo?.height || 0;
                          const dimFor = (k) => (k === "x" || k === "w") ? vw : vh;
                          const pxVal = Math.round((focusedOp.region[key] || 0) * (dimFor(key) || 1));
                          return (
                            <div key={key} className="flex items-center gap-1.5">
                              <span className="text-[10px] w-3 font-mono" style={{ color: "var(--text-dim)" }}>{label}</span>
                              <input
                                type="number"
                                value={pxVal}
                                onChange={(e) => {
                                  const px = Number(e.target.value);
                                  if (!Number.isFinite(px) || !dimFor(key)) return;
                                  updateFocused({
                                    region: clampRegionToVideo(
                                      { ...focusedOp.region, [key]: px / dimFor(key) },
                                    ),
                                  });
                                }}
                                className="cap-input font-mono text-[10px] !py-0.5 flex-1 text-center"
                              />
                              <div className="flex gap-0.5">
                                {[-10, -1, 1, 10].map((step) => (
                                  <button
                                    key={step}
                                    onClick={() => {
                                      const d = dimFor(key) || 1;
                                      updateFocused({
                                        region: clampRegionToVideo(
                                          { ...focusedOp.region, [key]: focusedOp.region[key] + step / d },
                                        ),
                                      });
                                    }}
                                    className="cap-btn-secondary !text-[9px] !px-1 !py-0.5 font-mono"
                                    title={`${step > 0 ? "+" : ""}${step}px`}
                                  >
                                    {step > 0 ? `+${step}` : step}
                                  </button>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Time range */}
                  <div className="border-t pt-2" style={{ borderColor: "var(--border)" }}>
                    <span className="cap-input-label">Tiempo (s)</span>
                    <div className="grid grid-cols-2 gap-2">
                      <label>
                        <span className="text-[9px]" style={{ color: "var(--text-dim)" }}>Inicio</span>
                        <input
                          type="number"
                          value={focusedOp?.startTime ?? ""}
                          onChange={(e) => updateFocused({ startTime: e.target.value === "" ? null : Number(e.target.value) })}
                          disabled={!focusedOp}
                          placeholder="0"
                          className="cap-input font-mono text-[11px]"
                        />
                      </label>
                      <label>
                        <span className="text-[9px]" style={{ color: "var(--text-dim)" }}>Fin</span>
                        <input
                          type="number"
                          value={focusedOp?.endTime ?? ""}
                          onChange={(e) => updateFocused({ endTime: e.target.value === "" ? null : Number(e.target.value) })}
                          disabled={!focusedOp}
                          placeholder="fin"
                          className="cap-input font-mono text-[11px]"
                        />
                      </label>
                    </div>
                  </div>

                  {/* Actions */}
                  {focusedOp && (
                    <div className="border-t pt-2" style={{ borderColor: "var(--border)" }}>
                      <button
                        onClick={deleteFocusedOp}
                        className="cap-btn-secondary w-full text-[11px]"
                        style={{ color: "var(--rose)" }}
                      >
                        <Trash2 size={12} /> Eliminar operación
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Bottom section: Editable table */}
        <div
          ref={tableRef}
          tabIndex={0}
          onKeyDown={handleTableKey}
          className="flex-1 overflow-auto focus:outline-none"
          style={{ minHeight: "180px", maxHeight: "40vh" }}
        >
          {!hasRegions ? (
            <div className="p-6 text-center text-[11px]" style={{ color: "var(--text-dim)" }}>
              Tabla de texto plano: muestra todas las operaciones de texto del video.
            </div>
          ) : (
            <table className="w-full text-[11px] border-collapse">
              <thead>
                <tr>
                  <th className="text-left p-2 sticky top-0 z-10 w-[40px]" style={{ background: "var(--bg-elevated)", color: "var(--text-dim)", borderBottom: "1px solid var(--border)" }}>#</th>
                  <th className="text-left p-2 sticky top-0 z-10" style={{ background: "var(--bg-elevated)", color: "var(--text-dim)", borderBottom: "1px solid var(--border)" }}>Video</th>
                  <th className="text-left p-2 sticky top-0 z-10 w-[80px]" style={{ background: "var(--bg-elevated)", color: "var(--text-dim)", borderBottom: "1px solid var(--border)" }}>ID</th>
                  {templateRegions.map((tr) => {
                    const excelCol = excelMapping.columns?.[tr.id];
                    return (
                    <th
                      key={tr.id}
                      className="text-left p-2 sticky top-0 z-10 cursor-pointer"
                      style={{
                        background: focused.regionId === tr.id ? "rgba(168,85,247,0.15)" : "var(--bg-elevated)",
                        color: focused.regionId === tr.id ? "var(--purple)" : "var(--purple)",
                        borderBottom: "1px solid var(--border)",
                        borderLeft: focused.regionId === tr.id ? "2px solid var(--purple)" : "none",
                      }}
                      onClick={() => setFocused((f) => ({ ...f, regionId: tr.id }))}
                      title={excelCol ? `Columna Excel: ${excelCol}` : "Sin columna Excel mapeada"}
                    >
                      <div>{tr.label}</div>
                      {excelCol && (
                        <div className="text-[9px] font-mono font-normal truncate max-w-[120px]" style={{ color: "var(--text-dim)" }}>
                          → {excelCol}
                        </div>
                      )}
                    </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {queue.map((item, idx) => {
                  const id = store.getExcelDisplayId(idx);
                  const matchStatus = excelMatchStatus[idx];
                  const isFocusedRow = focused.videoIdx === idx;
                  return (
                    <tr
                      key={idx}
                      onClick={() => setFocused((f) => ({ ...f, videoIdx: idx }))}
                      className="cursor-pointer"
                      style={{
                        background: isFocusedRow ? "rgba(168,85,247,0.05)" : "transparent",
                        borderBottom: "1px solid var(--border)",
                      }}
                    >
                      <td className="p-2 text-center font-mono" style={{ color: isFocusedRow ? "var(--purple)" : "var(--text-dim)" }}>
                        {idx + 1}
                      </td>
                      <td className="p-2 font-medium" style={{ color: isFocusedRow ? "var(--text-primary)" : "var(--text-secondary)" }} title={item.filename}>
                        {item.filename}
                      </td>
                      <td className="p-2 font-mono text-[10px]" style={{ color: "var(--text-dim)" }} title={matchStatus === "matched" ? "Vinculado a Excel" : matchStatus || ""}>
                        {id}
                        {matchStatus === "unmatched" && excelPath && (
                          <span className="ml-1 text-[9px]" style={{ color: "var(--amber)" }} title="Sin fila en Excel">⚠</span>
                        )}
                      </td>
                      {templateRegions.map((tr) => {
                        const { op, opIdx } = findOpForRegion(item.operations, tr.region);
                        const cellText = store.getCellTextForRegion(idx, tr.id);
                        const fromExcelOnly = !op?.text && !!cellText && excelMapping.columns?.[tr.id];
                        const isCellFocused = focused.videoIdx === idx && focused.regionId === tr.id;
                        const isEditing = editingCell && editingCell.videoIdx === idx && editingCell.regionId === tr.id;
                        return (
                          <td
                            key={tr.id}
                            onClick={(e) => { e.stopPropagation(); setFocused({ videoIdx: idx, regionId: tr.id }); }}
                            onDoubleClick={() => startInlineEdit(idx, tr.id, cellText)}
                            className="p-1 align-top"
                            style={{
                              borderLeft: isCellFocused ? "2px solid var(--purple)" : "none",
                              background: isCellFocused ? "rgba(168,85,247,0.08)" : "transparent",
                            }}
                          >
                            {isEditing ? (
                              <input
                                autoFocus
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onBlur={commitInlineEdit}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") { e.preventDefault(); commitInlineEdit(); }
                                  else if (e.key === "Escape") { e.preventDefault(); cancelInlineEdit(); }
                                  e.stopPropagation();
                                }}
                                className="w-full px-1.5 py-0.5 rounded text-[11px] outline-none"
                                style={{
                                  background: "var(--bg-app)",
                                  border: "1px solid var(--purple)",
                                  color: "var(--text-primary)",
                                }}
                              />
                            ) : cellText ? (
                              <div
                                className="px-1.5 py-0.5 rounded"
                                style={{
                                  color: fromExcelOnly ? "var(--text-secondary)" : "var(--text-primary)",
                                  fontStyle: fromExcelOnly ? "italic" : "normal",
                                }}
                                title={fromExcelOnly ? "Valor desde Excel (doble clic para editar)" : undefined}
                              >
                                {cellText}
                              </div>
                            ) : (
                              <div
                                className="px-1.5 py-0.5 rounded text-center text-[10px] italic"
                                style={{ color: "var(--text-dim)" }}
                              >
                                +
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
