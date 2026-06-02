import { useRef, useEffect, useState, useCallback } from "react";
import useEditorStore from "../stores/useEditorStore";
import useCanvas from "../hooks/useCanvas";
import { regionToScreen, fmtTime } from "../utils/video-utils";
import DelogoLivePreview from "./DelogoLivePreview";
import { Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, Eye, EyeOff } from "lucide-react";

const opModeColor = {
  text: "#a855f7",
  blur: "#00f0ea",
  delogo: "#f43f5e",
  crop: "#fbbf24",
  image: "#10b981",
};

const isOpActive = (op, t) => {
  const s = op.startTime;
  const e = op.endTime;
  if (s == null && e == null) return true;
  if (s != null && t < s) return false;
  if (e != null && t > e) return false;
  return true;
};

export default function VideoPreview() {
  const store = useEditorStore();
  const sel = store.selected();
  const videoRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [seeking, setSeeking] = useState(false);
  const [showTimeline, setShowTimeline] = useState(true);
  const [draggingOp, setDraggingOp] = useState(null);
  const [dragStart, setDragStart] = useState(null);
  const { canvasRef, onMouseDown, onMouseMove, onMouseUp } = useCanvas(videoRef);

  const seekTo = useCallback((fraction) => {
    const v = videoRef.current;
    if (v && duration > 0) v.currentTime = fraction * duration;
  }, [duration]);

  useEffect(() => {
    if (!sel) {
      store.setCurrentRegion(null);
    }
  }, [sel?.path]);

  /* Video event listeners */
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
  }, [sel?.path, seeking]);

  /* Keyboard commands dispatched by useKeyboard (play/pause, seek) */
  useEffect(() => {
    const onCommand = (e) => {
      const v = videoRef.current;
      if (!v) return;
      const { type, delta, value } = e.detail || {};
      if (type === "toggle-play") {
        if (v.paused) v.play(); else v.pause();
      } else if (type === "seek" && Number.isFinite(delta)) {
        if (!v.duration) return;
        v.currentTime = Math.max(0, Math.min(v.duration, v.currentTime + delta));
      } else if (type === "seek-abs" && Number.isFinite(value)) {
        if (!v.duration) return;
        v.currentTime = value >= 1 ? v.duration - 0.05 : value * v.duration;
      }
    };
    window.addEventListener("beru:video:command", onCommand);
    return () => window.removeEventListener("beru:video:command", onCommand);
  }, [sel?.path]);

  useEffect(() => {
    setPlaying(false);
    setCurrentTime(0);
    setDuration(sel?.duration || 0);
  }, [sel?.path]);

  // Drag handlers for image operations
  const handleImageDragStart = (op, opIdx, e) => {
    e.stopPropagation();
    const video = videoRef.current;
    if (!video) return;
    const rect = video.getBoundingClientRect();
    setDraggingOp({ op, opIdx });
    setDragStart({
      mouseX: e.clientX,
      mouseY: e.clientY,
      regionX: op.region.x,
      regionY: op.region.y,
      videoWidth: rect.width,
      videoHeight: rect.height,
    });
  };

  const handleImageDragMove = useCallback((e) => {
    if (!draggingOp || !dragStart) return;
    const video = videoRef.current;
    if (!video) return;
    
    const deltaX = e.clientX - dragStart.mouseX;
    const deltaY = e.clientY - dragStart.mouseY;
    
    // Convert pixel delta to normalized coordinates
    const rect = video.getBoundingClientRect();
    const normalizedDeltaX = deltaX / rect.width;
    const normalizedDeltaY = deltaY / rect.height;
    
    const newX = Math.max(0, Math.min(1 - draggingOp.op.region.w, dragStart.regionX + normalizedDeltaX));
    const newY = Math.max(0, Math.min(1 - draggingOp.op.region.h, dragStart.regionY + normalizedDeltaY));
    
    const updatedRegion = {
      ...draggingOp.op.region,
      x: newX,
      y: newY,
    };
    
    store.updateOperationRegion(draggingOp.opIdx, updatedRegion);
  }, [draggingOp, dragStart, store]);

  const handleImageDragEnd = useCallback(() => {
    setDraggingOp(null);
    setDragStart(null);
  }, []);

  useEffect(() => {
    if (draggingOp) {
      window.addEventListener('mousemove', handleImageDragMove);
      window.addEventListener('mouseup', handleImageDragEnd);
      return () => {
        window.removeEventListener('mousemove', handleImageDragMove);
        window.removeEventListener('mouseup', handleImageDragEnd);
      };
    }
  }, [draggingOp, handleImageDragMove, handleImageDragEnd]);

  if (!sel) {
    return (
      <div className="flex-1 flex items-center justify-center flex-col gap-3">
        <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: "var(--bg-elevated)" }}>
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: "var(--text-dim)" }}>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
        </div>
        <p className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>Selecciona un video de la cola</p>
      </div>
    );
  }

  const seekFrac = duration > 0 ? currentTime / duration : 0;

  return (
    <div className="flex-1 flex items-center justify-center p-4 min-h-0 relative">
      <div className="relative inline-block" style={{ maxWidth: "100%", maxHeight: "100%", overflow: "hidden" }}>
        <video ref={videoRef} src={sel.src}
          className="max-h-[calc(100vh-200px)] max-w-full block object-contain rounded"
          onLoadedMetadata={() => { store.setCurrentRegion(null); setDuration(videoRef.current?.duration || 0); }} />

        {/* Operation overlays */}
        {sel.operations.filter((op) => isOpActive(op, currentTime)).map((op, opIdx) => {
          const s = regionToScreen(op.region, videoRef.current);
          if (!s) return null;
          if (op.mode === "blur") {
            return (
              <div key={op.id} className="absolute pointer-events-none z-10"
                style={{ left: s.x, top: s.y, width: s.w, height: s.h }}>
                <div style={{ width: "100%", height: "100%",
                  background: "repeating-linear-gradient(45deg, rgba(255,255,255,0.08) 0px, rgba(255,255,255,0.08) 2px, transparent 2px, transparent 8px)",
                  border: "2px solid rgba(0,240,234,0.6)", borderRadius: "2px" }} />
                <div style={{ position: "absolute", inset: 0, backdropFilter: `blur(${(op.blurStrength || 20) * s.sy}px)`, WebkitBackdropFilter: `blur(${(op.blurStrength || 20) * s.sy}px)` }} />
              </div>
            );
          }
          if (op.mode === "crop") {
            return <div key={op.id} className="absolute pointer-events-none z-10"
              style={{ left: s.x, top: s.y, width: s.w, height: s.h,
                outline: "2px dashed #fbbf24", outlineOffset: "-1px" }} />;
          }
          if (op.mode === "delogo") {
            const dm = op.delogoMethod || "inpaint";
            let overlayStyle = { left: s.x, top: s.y, width: s.w, height: s.h };
            if (dm === "inpaint") {
              overlayStyle.background = "repeating-conic-gradient(rgba(239,68,68,0.15) 0% 25%, transparent 0% 50%) 0 0 / 16px 16px";
              overlayStyle.outline = "2px solid rgba(239,68,68,0.7)";
            } else if (dm === "blur") {
              overlayStyle.background = "repeating-linear-gradient(135deg, rgba(59,130,246,0.10) 0px, rgba(59,130,246,0.10) 2px, transparent 2px, transparent 8px)";
              overlayStyle.backdropFilter = `blur(${(op.blurStrength || 20) * s.sy}px)`;
              overlayStyle.WebkitBackdropFilter = `blur(${(op.blurStrength || 20) * s.sy}px)`;
              overlayStyle.outline = "2px dashed rgba(59,130,246,0.7)";
            } else {
              overlayStyle.background = `${op.delogoFillColor || "black"}`;
              overlayStyle.opacity = op.delogoFillOpacity ?? 1;
              overlayStyle.outline = "2px solid rgba(239,68,68,0.6)";
            }
            return <div key={op.id} className="absolute pointer-events-none z-10" style={overlayStyle} />;
          }
          if (op.mode === "image" && op.imagePath) {
            const dataUrl = store.imageDataCache?.[op.imagePath];
            const isDragging = draggingOp?.opIdx === opIdx;
            return (
              <div key={op.id} 
                className={`absolute z-10 ${isDragging ? 'cursor-grabbing' : 'cursor-grab hover:cursor-grab'}`}
                style={{ 
                  left: s.x, 
                  top: s.y, 
                  width: s.w, 
                  height: s.h,
                  opacity: op.imageOpacity ?? 1,
                  outline: isDragging ? "2px solid rgba(16,185,129,1)" : "1px dashed rgba(16,185,129,0.6)",
                  pointerEvents: 'auto',
                }}
                onMouseDown={(e) => handleImageDragStart(op, opIdx, e)}
              >
                {dataUrl ? (
                  <img src={dataUrl} alt="" className="w-full h-full" style={{ objectFit: "fill" }} draggable={false} />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-[10px]" style={{ background: "rgba(16,185,129,0.10)", color: "#10b981" }}>
                    {op.imagePath.split(/[\\/]/).pop()}
                  </div>
                )}
              </div>
            );
          }
          if (op.mode === "text" && op.text) {
            const fontSize = Math.max(1, (op.fontSize || 24) * s.sy);
            const bgOn = op.bgEnabled !== false;
            const baseWeight = op.fontWeight ?? (op.bold ? 700 : 400);
            const letterSpacing = (op.letterSpacing || 0) * s.sy;
            const textOpacity = op.textOpacity ?? 1;
            const align = op.textAlign || "left";
            const boxPad = bgOn ? Math.max(2, (op.boxBorderWidth || 4) * s.sy) : 0;
            return (
              <div key={op.id} className="absolute pointer-events-none z-10"
                style={{ left: s.x, top: s.y, width: s.w, height: s.h }}>
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
          }
          return null;
        })}

        {/* Live blur preview while configuring */}
        {store.sidebarMode === "logo" && store.activeTool === "blur" && store.currentRegion && (() => {
          const s = regionToScreen(store.currentRegion, videoRef.current);
          if (!s) return null;
          const blurPx = Math.max(1, store.blurStrength || 20);
          return (
            <div className="absolute pointer-events-none z-10"
              style={{ left: s.x, top: s.y, width: s.w, height: s.h }}>
              <div style={{ 
                width: "100%", 
                height: "100%",
                background: "repeating-linear-gradient(45deg, rgba(255,255,255,0.08) 0px, rgba(255,255,255,0.08) 2px, transparent 2px, transparent 8px)",
                border: "2px solid rgba(0,240,234,0.6)", 
                borderRadius: "2px" 
              }} />
              <div style={{ 
                position: "absolute", 
                inset: 0, 
                backdropFilter: `blur(${blurPx}px)`, 
                WebkitBackdropFilter: `blur(${blurPx}px)`,
                borderRadius: "2px"
              }} />
            </div>
          );
        })()}

        {/* Live text preview while configuring */}
        {store.sidebarMode === "logo" && store.activeTool === "text" && store.currentRegion && store.textInput && (() => {
          const s = regionToScreen(store.currentRegion, videoRef.current);
          if (!s) return null;
          const fontSize = Math.max(1, (store.textFontSize || 32) * s.sy);
          const bgOn = store.bgEnabled !== false;
          const baseWeight = store.fontWeight ?? (store.bold ? 700 : 400);
          const letterSpacing = (store.letterSpacing || 0) * s.sy;
          const textOpacity = store.textOpacity ?? 1;
          const align = store.textAlign || "left";
          const boxPad = bgOn ? Math.max(2, (store.boxBorderWidth || 4) * s.sy) : 0;
          return (
            <div className="absolute pointer-events-none z-10"
              style={{ left: s.x, top: s.y, width: s.w, height: s.h }}>
              {bgOn && (
                <div style={{
                  position: "absolute", inset: 0,
                  background: store.bgColor || "black",
                  opacity: store.bgOpacity ?? 0.65,
                  borderRadius: `${Math.max(3, 6 * s.sy)}px`,
                }} />
              )}
              <div style={{
                position: "relative",
                color: store.textFontColor || "white",
                opacity: textOpacity,
                fontSize: `${fontSize}px`,
                fontFamily: `"${store.fontFamily || "Arial"}", sans-serif`,
                fontWeight: baseWeight,
                fontStyle: store.italic ? "italic" : "normal",
                letterSpacing: `${letterSpacing}px`,
                textAlign: align,
                padding: `${boxPad}px`,
                whiteSpace: "pre-wrap",
                WebkitTextStroke: store.borderWidth > 0 ? `${store.borderWidth * s.sy}px ${store.borderColor || "black"}` : "none",
              }}>{store.textInput}</div>
            </div>
          );
        })()}

        {/* Batch template region overlays */}
        {store.sidebarMode === "batch" && store.templateRegions.map((tr) => {
          const s = regionToScreen(tr.region, videoRef.current);
          if (!s) return null;
          return (
            <div key={tr.id} className="absolute pointer-events-none z-20"
              style={{
                left: s.x, top: s.y, width: s.w, height: s.h,
                border: "2px solid rgba(168,85,247,0.85)",
                background: "rgba(168,85,247,0.08)",
                borderRadius: "3px",
              }}>
              <div style={{
                position: "absolute", top: -18, left: 0,
                background: "rgba(168,85,247,0.9)",
                color: "white",
                fontSize: "10px",
                fontWeight: 600,
                padding: "1px 6px",
                borderRadius: "3px 3px 0 0",
                whiteSpace: "nowrap",
                letterSpacing: "0.5px",
              }}>
                {tr.label}
              </div>
            </div>
          );
        })}

        {/* Live preview of the in-progress delogo effect (under the selection handles) */}
        <DelogoLivePreview videoRef={videoRef} />

        {/* Drawing canvas */}
        <canvas ref={canvasRef} className="absolute top-0 left-0"
          onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp} />
      </div>

      {/* Video Player Controls */}
      <div className="absolute bottom-0 left-0 right-0 z-30"
        style={{ background: "linear-gradient(transparent, rgba(0,0,0,0.85))", paddingTop: "24px" }}>
        {/* Seek bar with timeline markers */}
        <div className="px-3 pb-1 relative">
          {showTimeline && duration > 0 && sel.operations.some((op) => op.startTime != null || op.endTime != null) && (
            <div className="absolute left-3 right-3 top-1/2 -translate-y-1/2 h-3 pointer-events-none z-10">
              {sel.operations.map((op) => {
                const s = op.startTime ?? 0;
                const e = op.endTime ?? duration;
                const left = (s / duration) * 100;
                const width = Math.max(0.5, ((e - s) / duration) * 100);
                return (
                  <div key={op.id}
                    className="absolute h-1 rounded-sm"
                    style={{
                      left: `${left}%`,
                      width: `${width}%`,
                      top: "50%",
                      transform: "translateY(-50%)",
                      background: opModeColor[op.mode] || "#888",
                      opacity: isOpActive(op, currentTime) ? 0.85 : 0.25,
                    }}
                    title={`${op.mode} ${fmtTime(s)} → ${fmtTime(e)}`} />
                );
              })}
            </div>
          )}
          <input type="range" min={0} max={1} step={0.001}
            value={seekFrac}
            onMouseDown={() => setSeeking(true)}
            onMouseUp={() => setSeeking(false)}
            onChange={(e) => {
              const frac = parseFloat(e.target.value);
              setCurrentTime(frac * duration);
              seekTo(frac);
            }}
            className="w-full h-1 rounded-full appearance-none cursor-pointer relative z-20"
            style={{
              accentColor: "var(--accent)",
              background: `linear-gradient(to right, var(--accent) ${seekFrac * 100}%, var(--border) ${seekFrac * 100}%)`,
            }} />
        </div>
        {/* Buttons & time */}
        <div className="flex items-center gap-2 px-3 pb-2">
          <button onClick={() => { const v = videoRef.current; if (v) v.currentTime = 0; }}
            className="p-1 rounded hover:bg-white/10" style={{ color: "var(--text-dim)" }}>
            <SkipBack size={14} />
          </button>
          <button onClick={() => {
            const v = videoRef.current;
            if (!v) return;
            if (v.paused) v.play(); else v.pause();
          }}
            className="p-1.5 rounded-full hover:bg-white/15"
            style={{ color: "var(--accent)" }}>
            {playing ? <Pause size={16} /> : <Play size={16} />}
          </button>
          <button onClick={() => { const v = videoRef.current; if (v && v.duration) v.currentTime = v.duration; }}
            className="p-1 rounded hover:bg-white/10" style={{ color: "var(--text-dim)" }}>
            <SkipForward size={14} />
          </button>
          <button onClick={() => {
            const v = videoRef.current;
            if (v) { v.muted = !v.muted; setMuted(v.muted); }
          }}
            className="p-1 rounded hover:bg-white/10" style={{ color: "var(--text-dim)" }}>
            {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
          </button>
          <button onClick={() => setShowTimeline((v) => !v)}
            className="p-1 rounded hover:bg-white/10"
            style={{ color: showTimeline ? "var(--accent)" : "var(--text-dim)" }}
            title={showTimeline ? "Ocultar marcadores de tiempo" : "Mostrar marcadores de tiempo"}>
            {showTimeline ? <Eye size={14} /> : <EyeOff size={14} />}
          </button>
          <span className="text-[10px] font-mono ml-1" style={{ color: "var(--text-secondary)" }}>
            {fmtTime(currentTime)} / {fmtTime(duration)}
          </span>
          <div className="flex-1" />
          <span className="text-[9px] font-mono" style={{ color: "var(--text-dim)" }}>
            {sel.width}×{sel.height}
          </span>
        </div>
      </div>
    </div>
  );
}