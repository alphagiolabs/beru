import { Bold, Italic, Trash2, Plus, AlignLeft, AlignCenter, AlignRight } from "lucide-react";
import { clampRegionToVideo } from "../../utils/video-utils";
import { FONT_FAMILIES, FONT_WEIGHTS, TEXT_ALIGNS } from "../../utils/types";
import { normalizeColor } from "../../utils/color-utils";

export default function TableEditorFocusPanel({
  hasRegions,
  focusedRegion,
  focusedVideo,
  focused,
  queueLength,
  focusedOp,
  updateFocused,
  createFocusedOp,
  deleteFocusedOp,
}) {
  return (
          <div className="w-[360px] flex-shrink-0 flex flex-col border-l overflow-hidden" style={{ borderColor: "var(--border)" }}>
            <div className="px-3 py-2 border-b flex items-center justify-between" style={{ borderColor: "var(--border)" }}>
              <div className="text-[10px] font-semibold tracking-widest uppercase" style={{ color: "var(--text-dim)" }}>
                Fila de edición
              </div>
              {focusedVideo && (
                <span className="text-[10px] font-mono" style={{ color: "var(--text-dim)" }}>
                  V{focused.videoIdx + 1}/{queueLength}
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
  );
}
