import { useRef, useEffect, useState, useCallback } from "react";
import { shallow } from "zustand/shallow";
import useEditorStore from "../stores/useEditorStore";
import useCanvas from "../hooks/useCanvas";
import { regionToScreen, fmtTime } from "../utils/video-utils";
import DelogoLivePreview from "./DelogoLivePreview";
import TextOverlay from "./TextOverlay";
import { findTextOpForRegion, getGlobalTextStyleFromState } from "../utils/text-style";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Eye,
  EyeOff,
  ScanEye,
  X,
  Loader2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  opModeColor,
  isOpActive,
  resolvedDuration,
  MIN_ZOOM,
  MAX_ZOOM,
} from "./video-preview/utils";
import useZoomPan from "./video-preview/useZoomPan";

export default function VideoPreview() {
  const {
    selectedIdx,
    sel,
    sidebarMode,
    activeTool,
    currentRegion,
    textInput,
    blurStrength,
    imageDataCache,
    templateRegions,
    selectedTemplateRegionId,
    watermark,
  } = useEditorStore(
    (s) => ({
      selectedIdx: s.selectedIdx,
      sel: s.selectedIdx >= 0 && s.selectedIdx < s.queue.length ? s.queue[s.selectedIdx] : null,
      sidebarMode: s.sidebarMode,
      activeTool: s.activeTool,
      currentRegion: s.currentRegion,
      textInput: s.textInput,
      blurStrength: s.blurStrength,
      imageDataCache: s.imageDataCache,
      templateRegions: s.templateRegions,
      selectedTemplateRegionId: s.selectedTemplateRegionId,
      watermark: s.watermark,
    }),
    shallow,
  );
  const setCurrentRegion = useEditorStore((s) => s.setCurrentRegion);
  const updateOperationRegion = useEditorStore((s) => s.updateOperationRegion);
  const getBatchPreviewPayload = useEditorStore((s) => s.getBatchPreviewPayload);
  const buildPreviewFrameJob = useEditorStore((s) => s.buildPreviewFrameJob);
  const showToast = useEditorStore((s) => s.showToast);
  const videoRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [seeking, setSeeking] = useState(false);
  const [showTimeline, setShowTimeline] = useState(true);
  const [draggingOp, setDraggingOp] = useState(null);
  const [dragStart, setDragStart] = useState(null);
  const [draggingBatchText, setDraggingBatchText] = useState(null);
  const [batchTextDragStart, setBatchTextDragStart] = useState(null);
  const [, setLayoutTick] = useState(0);
  const [videoError, setVideoError] = useState(null);
  const [ffmpegPreviewUrl, setFfmpegPreviewUrl] = useState(null);
  const [ffmpegPreviewLoading, setFfmpegPreviewLoading] = useState(false);
  const [showFfmpegPreview, setShowFfmpegPreview] = useState(false);
  const [previewCompareMode, setPreviewCompareMode] = useState("ffmpeg");
  const { canvasRef, onMouseDown, onMouseMove, onMouseUp } = useCanvas(videoRef);

  const isSplitCompare = showFfmpegPreview && ffmpegPreviewUrl && previewCompareMode === "split";
  const {
    outerRef,
    wrapperRef,
    zoom,
    pan,
    isPanning,
    zoomIn,
    zoomOut,
    zoomReset,
    onPanMouseDown,
    isSplitCompareRef,
    setZoomBoth,
    setPanBoth,
  } = useZoomPan(videoRef, isSplitCompare);
  isSplitCompareRef.current = isSplitCompare;
  const showFfmpegOverlay =
    showFfmpegPreview && ffmpegPreviewUrl && previewCompareMode === "ffmpeg";

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const ro = new ResizeObserver(() => setLayoutTick((t) => t + 1));
    ro.observe(v);
    return () => ro.disconnect();
  }, [sel?.path]);

  const seekTo = useCallback(
    (fraction) => {
      const v = videoRef.current;
      const d = resolvedDuration(v, duration || sel?.duration);
      if (v && d > 0) v.currentTime = Math.max(0, Math.min(d, fraction * d));
    },
    [duration, sel?.duration],
  );

  useEffect(() => {
    if (!sel) {
      setCurrentRegion(null);
    }
  }, [sel?.path]);

  /* Video event listeners */
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTimeUpdate = () => {
      if (!seeking) setCurrentTime(v.currentTime);
    };
    const onLoadedMeta = () => setDuration(resolvedDuration(v, sel?.duration));
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
  }, [sel?.path, sel?.duration, seeking]);

  /* Keyboard commands dispatched by useKeyboard (play/pause, seek) */
  useEffect(() => {
    const onCommand = (e) => {
      const v = videoRef.current;
      if (!v) return;
      const { type, delta, value } = e.detail || {};
      if (type === "toggle-play") {
        if (v.paused) v.play();
        else v.pause();
      } else if (type === "seek" && Number.isFinite(delta)) {
        const d = resolvedDuration(v, sel?.duration);
        if (!d) return;
        v.currentTime = Math.max(0, Math.min(d, v.currentTime + delta));
      } else if (type === "seek-abs" && Number.isFinite(value)) {
        const d = resolvedDuration(v, sel?.duration);
        if (!d) return;
        v.currentTime = value >= 1 ? Math.max(0, d - 0.05) : value * d;
      }
    };
    window.addEventListener("beru:video:command", onCommand);
    return () => window.removeEventListener("beru:video:command", onCommand);
  }, [sel?.path, sel?.duration]);

  useEffect(() => {
    setPlaying(false);
    setCurrentTime(0);
    setDuration(sel?.duration || 0);
    setVideoError(null);
    setFfmpegPreviewUrl(null);
    setShowFfmpegPreview(false);
    setPreviewCompareMode("ffmpeg");
    setZoomBoth(1);
    setPanBoth({ x: 0, y: 0 });
  }, [sel?.path, setZoomBoth, setPanBoth]);

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

  const handleImageDragMove = useCallback(
    (e) => {
      if (!draggingOp || !dragStart) return;
      const video = videoRef.current;
      if (!video) return;

      const deltaX = e.clientX - dragStart.mouseX;
      const deltaY = e.clientY - dragStart.mouseY;

      // Convert pixel delta to normalized coordinates
      const rect = video.getBoundingClientRect();
      const normalizedDeltaX = deltaX / rect.width;
      const normalizedDeltaY = deltaY / rect.height;

      const newX = Math.max(
        0,
        Math.min(1 - draggingOp.op.region.w, dragStart.regionX + normalizedDeltaX),
      );
      const newY = Math.max(
        0,
        Math.min(1 - draggingOp.op.region.h, dragStart.regionY + normalizedDeltaY),
      );

      const updatedRegion = {
        ...draggingOp.op.region,
        x: newX,
        y: newY,
      };

      updateOperationRegion(draggingOp.opIdx, updatedRegion);
    },
    [draggingOp, dragStart, updateOperationRegion],
  );

  const handleImageDragEnd = useCallback(() => {
    setDraggingOp(null);
    setDragStart(null);
  }, []);

  useEffect(() => {
    if (draggingOp) {
      window.addEventListener("mousemove", handleImageDragMove);
      window.addEventListener("mouseup", handleImageDragEnd);
      return () => {
        window.removeEventListener("mousemove", handleImageDragMove);
        window.removeEventListener("mouseup", handleImageDragEnd);
      };
    }
  }, [draggingOp, handleImageDragMove, handleImageDragEnd]);

  const handleBatchTextDragStart = (tr, e) => {
    e.preventDefault();
    e.stopPropagation();
    const video = videoRef.current;
    if (!video) return;
    if (!video.paused) video.pause();

    const state = useEditorStore.getState();
    const videoIdx = state.selectedIdx;
    const item = state.queue[videoIdx];
    if (videoIdx < 0 || !item) return;

    state.setSelectedTemplateRegion(tr.id);
    let { op, opIdx } = findTextOpForRegion(item.operations, tr.region, tr.id);
    if (!op) {
      const text = state.getCellTextForRegion(videoIdx, tr.id);
      opIdx = state.createTextOpForRegion(videoIdx, tr.id);
      if (opIdx < 0) return;
      if (String(text ?? "").length > 0) {
        state.updateOperationText(videoIdx, opIdx, String(text));
      }
      op = useEditorStore.getState().queue[videoIdx]?.operations?.[opIdx];
    }
    if (!op?.region) return;

    setDraggingBatchText({ videoIdx, opIdx, regionId: tr.id });
    setBatchTextDragStart({
      mouseX: e.clientX,
      mouseY: e.clientY,
      region: { ...op.region },
    });
  };

  const handleBatchTextDragMove = useCallback(
    (e) => {
      if (!draggingBatchText || !batchTextDragStart) return;
      const video = videoRef.current;
      if (!video) return;
      const rect = video.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      const startRegion = batchTextDragStart.region;
      const deltaX = (e.clientX - batchTextDragStart.mouseX) / rect.width;
      const deltaY = (e.clientY - batchTextDragStart.mouseY) / rect.height;
      const nextRegion = {
        ...startRegion,
        x: Math.max(0, Math.min(1 - startRegion.w, startRegion.x + deltaX)),
        y: Math.max(0, Math.min(1 - startRegion.h, startRegion.y + deltaY)),
      };

      useEditorStore
        .getState()
        .updateOperation(draggingBatchText.videoIdx, draggingBatchText.opIdx, {
          region: nextRegion,
        });
    },
    [draggingBatchText, batchTextDragStart],
  );

  const handleBatchTextDragEnd = useCallback(() => {
    setDraggingBatchText(null);
    setBatchTextDragStart(null);
  }, []);

  useEffect(() => {
    if (!draggingBatchText) return;
    window.addEventListener("mousemove", handleBatchTextDragMove);
    window.addEventListener("mouseup", handleBatchTextDragEnd);
    return () => {
      window.removeEventListener("mousemove", handleBatchTextDragMove);
      window.removeEventListener("mouseup", handleBatchTextDragEnd);
    };
  }, [draggingBatchText, handleBatchTextDragMove, handleBatchTextDragEnd]);

  const handleRenderPreviewFrame = useCallback(async () => {
    const api = window.api;
    if (!api?.renderPreviewFrame) {
      showToast?.({ kind: "err", text: "Preview FFmpeg no disponible" });
      return;
    }
    if (selectedIdx < 0 || !sel) return;

    const video = videoRef.current;
    if (video && !video.paused) video.pause();

    const ts = video?.currentTime ?? currentTime;
    const job = buildPreviewFrameJob(selectedIdx, ts);
    if (!job) {
      showToast?.({ kind: "err", text: "No se pudo construir el preview" });
      return;
    }

    setFfmpegPreviewLoading(true);
    try {
      const result = await api.renderPreviewFrame(job);
      if (result?.ok && result.data_url) {
        setFfmpegPreviewUrl(result.data_url);
        setPreviewCompareMode("ffmpeg");
        setShowFfmpegPreview(true);
      } else {
        showToast?.({
          kind: "err",
          text: result?.error || "No se pudo renderizar el frame",
        });
      }
    } catch (err) {
      showToast?.({ kind: "err", text: err.message || "Error al renderizar el frame" });
    } finally {
      setFfmpegPreviewLoading(false);
    }
  }, [selectedIdx, sel, currentTime, buildPreviewFrameJob, showToast]);

  useEffect(() => {
    const onRenderFrame = () => {
      handleRenderPreviewFrame();
    };
    window.addEventListener("beru:preview:renderFrame", onRenderFrame);
    return () => window.removeEventListener("beru:preview:renderFrame", onRenderFrame);
  }, [handleRenderPreviewFrame]);

  const dismissFfmpegPreview = useCallback(() => {
    setShowFfmpegPreview(false);
    setFfmpegPreviewUrl(null);
    setPreviewCompareMode("ffmpeg");
  }, []);

  if (!sel) {
    return (
      <div className="flex-1 flex items-center justify-center flex-col gap-3">
        <div
          className="w-12 h-12 rounded-full flex items-center justify-center"
          style={{ background: "var(--bg-elevated)" }}
        >
          <svg
            className="w-6 h-6"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            style={{ color: "var(--text-dim)" }}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
            />
          </svg>
        </div>
        <p className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
          Selecciona un video de la cola
        </p>
      </div>
    );
  }

  const seekFrac = duration > 0 ? currentTime / duration : 0;

  return (
    <div
      ref={outerRef}
      onMouseDown={onPanMouseDown}
      className="flex-1 flex items-center justify-center p-4 min-h-0 relative overflow-hidden"
      style={{ cursor: zoom > 1 ? (isPanning ? "grabbing" : "grab") : "default" }}
    >
      <div
        ref={wrapperRef}
        className={
          isSplitCompare
            ? "relative flex flex-row gap-2 items-stretch max-w-full"
            : "relative inline-block"
        }
        style={
          isSplitCompare
            ? { maxHeight: "calc(100vh-200px)" }
            : {
                maxWidth: "100%",
                maxHeight: "100%",
                overflow: zoom > 1 ? "visible" : "hidden",
                transform: `translate(${pan.x}px, ${pan.y}px)`,
              }
        }
      >
        <div className={isSplitCompare ? "relative flex-1 min-w-0 self-center" : "contents"}>
          {isSplitCompare && (
            <div
              className="absolute top-2 left-2 z-[26] px-2 py-1 rounded text-[9px] font-medium pointer-events-none"
              style={{ background: "rgba(0,0,0,0.75)", color: "var(--text-secondary)" }}
            >
              CSS
            </div>
          )}
          <video
            ref={videoRef}
            src={sel.src || null}
            className="max-h-[calc(100vh-200px)] max-w-full block object-contain rounded"
            style={{ imageRendering: "auto", transform: `scale(${zoom})`, transformOrigin: "0 0" }}
            preload="metadata"
            playsInline
            disablePictureInPicture
            controlsList="nodownload noplaybackrate"
            onLoadedMetadata={() => {
              setCurrentRegion(null);
              setDuration(resolvedDuration(videoRef.current, sel?.duration));
              setVideoError(null);
            }}
            onError={() => {
              const code = videoRef.current?.error?.code;
              const message = videoRef.current?.error?.message;
              setVideoError(
                message ? `${code ? `code ${code}: ` : ""}${message}` : `code ${code || "?"}`,
              );
            }}
          />

          {showFfmpegOverlay && (
            <div
              className="absolute inset-0 z-[25]"
              style={{ transform: `scale(${zoom})`, transformOrigin: "0 0" }}
            >
              <img
                src={ffmpegPreviewUrl}
                alt="Preview FFmpeg renderizado"
                className="w-full h-full object-contain rounded pointer-events-none"
                draggable={false}
              />
            </div>
          )}

          {videoError && (
            <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
              <div
                className="pointer-events-auto max-w-[80%] rounded px-3 py-2 text-[11px] font-medium"
                style={{ background: "rgba(244, 63, 94, 0.95)", color: "white" }}
              >
                No se pudo cargar el video ({videoError}). Si el archivo cambió de ubicación, vuelve
                a importarlo.
              </div>
            </div>
          )}

          {/* Operation overlays */}
          {sel.operations
            .filter((op) => isOpActive(op, currentTime))
            .map((op, opIdx) => {
              const s = regionToScreen(op.region, videoRef.current);
              if (!s) return null;
              if (op.mode === "blur") {
                return (
                  <div
                    key={op.id}
                    className="absolute pointer-events-none z-10"
                    style={{ left: s.x, top: s.y, width: s.w, height: s.h }}
                  >
                    <div
                      style={{
                        width: "100%",
                        height: "100%",
                        background:
                          "repeating-linear-gradient(45deg, rgba(255,255,255,0.08) 0px, rgba(255,255,255,0.08) 2px, transparent 2px, transparent 8px)",
                        border: "2px solid rgba(0,240,234,0.6)",
                        borderRadius: "2px",
                      }}
                    />
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        backdropFilter: `blur(${(op.blurStrength || 20) * s.sy}px)`,
                        WebkitBackdropFilter: `blur(${(op.blurStrength || 20) * s.sy}px)`,
                      }}
                    />
                  </div>
                );
              }
              if (op.mode === "crop") {
                return (
                  <div
                    key={op.id}
                    className="absolute pointer-events-none z-10"
                    style={{
                      left: s.x,
                      top: s.y,
                      width: s.w,
                      height: s.h,
                      outline: "2px dashed #fbbf24",
                      outlineOffset: "-1px",
                    }}
                  />
                );
              }
              if (op.mode === "delogo") {
                const dm = op.delogoMethod || "inpaint";
                let overlayStyle = { left: s.x, top: s.y, width: s.w, height: s.h };
                if (dm === "inpaint") {
                  overlayStyle.background =
                    "repeating-conic-gradient(rgba(239,68,68,0.15) 0% 25%, transparent 0% 50%) 0 0 / 16px 16px";
                  overlayStyle.outline = "2px solid rgba(239,68,68,0.7)";
                } else if (dm === "blur") {
                  overlayStyle.background =
                    "repeating-linear-gradient(135deg, rgba(59,130,246,0.10) 0px, rgba(59,130,246,0.10) 2px, transparent 2px, transparent 8px)";
                  overlayStyle.backdropFilter = `blur(${(op.blurStrength || 20) * s.sy}px)`;
                  overlayStyle.WebkitBackdropFilter = `blur(${(op.blurStrength || 20) * s.sy}px)`;
                  overlayStyle.outline = "2px dashed rgba(59,130,246,0.7)";
                } else {
                  overlayStyle.background = `${op.delogoFillColor || "black"}`;
                  overlayStyle.opacity = op.delogoFillOpacity ?? 1;
                  overlayStyle.outline = "2px solid rgba(239,68,68,0.6)";
                }
                return (
                  <div
                    key={op.id}
                    className="absolute pointer-events-none z-10"
                    style={overlayStyle}
                  />
                );
              }
              if (op.mode === "image" && op.imagePath) {
                const dataUrl = imageDataCache?.[op.imagePath];
                const isDragging = draggingOp?.opIdx === opIdx;
                return (
                  <div
                    key={op.id}
                    className={`absolute z-30 ${isDragging ? "cursor-grabbing" : "cursor-grab hover:cursor-grab"}`}
                    style={{
                      left: s.x,
                      top: s.y,
                      width: s.w,
                      height: s.h,
                      opacity: op.imageOpacity ?? 1,
                      outline: isDragging
                        ? "2px solid rgba(16,185,129,1)"
                        : "1px dashed rgba(16,185,129,0.6)",
                      pointerEvents: "auto",
                    }}
                    onMouseDown={(e) => handleImageDragStart(op, opIdx, e)}
                  >
                    {dataUrl ? (
                      <img
                        src={dataUrl}
                        alt=""
                        className="w-full h-full"
                        style={{ objectFit: "fill" }}
                        draggable={false}
                      />
                    ) : (
                      <div
                        className="w-full h-full flex items-center justify-center text-[10px]"
                        style={{ background: "rgba(16,185,129,0.10)", color: "#10b981" }}
                      >
                        {op.imagePath.split(/[\\/]/).pop()}
                      </div>
                    )}
                  </div>
                );
              }
              if (op.mode === "text" && op.text && sidebarMode !== "batch") {
                return (
                  <TextOverlay
                    key={op.id}
                    screen={s}
                    text={op.text}
                    style={op}
                    showOutline={false}
                  />
                );
              }
              return null;
            })}

          {/* Live blur preview while configuring */}
          {sidebarMode === "logo" &&
            activeTool === "blur" &&
            currentRegion &&
            (() => {
              const s = regionToScreen(currentRegion, videoRef.current);
              if (!s) return null;
              const blurPx = Math.max(1, (blurStrength || 20) * (s.sy || 1));
              return (
                <div
                  className="absolute pointer-events-none z-10"
                  style={{ left: s.x, top: s.y, width: s.w, height: s.h }}
                >
                  <div
                    style={{
                      width: "100%",
                      height: "100%",
                      background:
                        "repeating-linear-gradient(45deg, rgba(255,255,255,0.08) 0px, rgba(255,255,255,0.08) 2px, transparent 2px, transparent 8px)",
                      border: "2px solid rgba(0,240,234,0.6)",
                      borderRadius: "2px",
                    }}
                  />
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      backdropFilter: `blur(${blurPx}px)`,
                      WebkitBackdropFilter: `blur(${blurPx}px)`,
                      borderRadius: "2px",
                    }}
                  />
                </div>
              );
            })()}

          {/* Live text preview while configuring (logo mode) */}
          {sidebarMode === "logo" &&
            activeTool === "text" &&
            currentRegion &&
            textInput &&
            (() => {
              const s = regionToScreen(currentRegion, videoRef.current);
              if (!s) return null;
              return (
                <TextOverlay
                  screen={s}
                  text={textInput}
                  style={getGlobalTextStyleFromState(useEditorStore.getState())}
                  showOutline={false}
                />
              );
            })()}

          {/* Batch: live text preview per template region */}
          {sidebarMode === "batch" &&
            selectedIdx >= 0 &&
            templateRegions.map((tr) => {
              const payload = getBatchPreviewPayload(selectedIdx, tr.id);
              if (!payload) return null;
              const s = regionToScreen(payload.region, videoRef.current);
              if (!s) return null;
              const isSelected = selectedTemplateRegionId === tr.id;
              const isDragging =
                draggingBatchText?.videoIdx === selectedIdx && draggingBatchText.regionId === tr.id;
              return (
                <TextOverlay
                  key={tr.id}
                  screen={s}
                  text={payload.text}
                  style={payload.style}
                  isFocused={isSelected}
                  showOutline
                  label={tr.label}
                  interactive
                  cursor={isDragging ? "grabbing" : "grab"}
                  zIndex={20}
                  onMouseDown={(e) => handleBatchTextDragStart(tr, e)}
                />
              );
            })}

          {/* Batch: preview while drawing a new region */}
          {sidebarMode === "batch" &&
            currentRegion &&
            (() => {
              const s = regionToScreen(currentRegion, videoRef.current);
              if (!s) return null;
              return (
                <TextOverlay
                  screen={s}
                  text="Texto de ejemplo"
                  style={getGlobalTextStyleFromState(useEditorStore.getState())}
                  isFocused
                  showOutline
                />
              );
            })()}

          {/* Global watermark preview */}
          {watermark?.enabled &&
            (() => {
              const video = videoRef.current;
              if (!video) return null;
              const vw = video.videoWidth || 1;
              const vh = video.videoHeight || 1;
              const rect = video.getBoundingClientRect();
              const sx = rect.width / vw;
              const sy = rect.height / vh;
              const margin = 10;
              const pos = watermark.position || "bottom-right";
              const posMap = {
                "top-left": { left: margin, top: margin },
                "top-center": { left: "50%", top: margin, transform: "translateX(-50%)" },
                "top-right": { right: margin, top: margin },
                "center-left": { left: margin, top: "50%", transform: "translateY(-50%)" },
                center: { left: "50%", top: "50%", transform: "translate(-50%, -50%)" },
                "center-right": { right: margin, top: "50%", transform: "translateY(-50%)" },
                "bottom-left": { left: margin, bottom: margin + 60 },
                "bottom-center": {
                  left: "50%",
                  bottom: margin + 60,
                  transform: "translateX(-50%)",
                },
                "bottom-right": { right: margin, bottom: margin + 60 },
              };
              const posStyle = posMap[pos] || posMap["bottom-right"];
              /* Wrapper sized to the video's rendered (post-zoom) box so that
               * right/bottom-anchored positions stay aligned with the visible
               * video area at any zoom level. */
              const boxStyle = {
                position: "absolute",
                left: 0,
                top: 0,
                width: rect.width,
                height: rect.height,
                pointerEvents: "none",
                zIndex: 20,
              };
              if (watermark.type === "text" && watermark.text) {
                const fontSize = Math.max(8, (watermark.fontSize || 18) * sy);
                return (
                  <div className="absolute pointer-events-none z-20" style={boxStyle}>
                    <div
                      className="absolute"
                      style={{
                        ...posStyle,
                        opacity: watermark.opacity ?? 0.5,
                        fontSize: `${fontSize}px`,
                        fontFamily: `"${watermark.fontFamily || "Arial"}", sans-serif`,
                        color: watermark.fontColor || "#ffffff",
                        textShadow: "1px 1px 3px rgba(0,0,0,0.7)",
                        whiteSpace: "nowrap",
                        userSelect: "none",
                      }}
                    >
                      {watermark.text}
                    </div>
                  </div>
                );
              }
              if (watermark.type === "image" && watermark.imageDataUrl) {
                const baseSize = 80 * sy;
                const scaledSize = baseSize * (watermark.scale || 1);
                return (
                  <div className="absolute pointer-events-none z-20" style={boxStyle}>
                    <div
                      className="absolute"
                      style={{ ...posStyle, opacity: watermark.opacity ?? 0.5 }}
                    >
                      <img
                        src={watermark.imageDataUrl}
                        alt=""
                        style={{
                          height: `${scaledSize}px`,
                          width: "auto",
                          objectFit: "contain",
                        }}
                        draggable={false}
                      />
                    </div>
                  </div>
                );
              }
              return null;
            })()}

          {/* Live preview of the in-progress delogo effect (under the selection handles) */}
          <DelogoLivePreview videoRef={videoRef} />

          {/* Drawing canvas */}
          <canvas
            ref={canvasRef}
            className="absolute top-0 left-0"
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
          />
        </div>

        {isSplitCompare && (
          <div className="relative flex-1 min-w-0 flex items-center justify-center rounded overflow-hidden">
            <img
              src={ffmpegPreviewUrl}
              alt="Preview FFmpeg renderizado"
              className="max-h-[calc(100vh-200px)] max-w-full object-contain rounded"
              draggable={false}
            />
            <div
              className="absolute top-2 left-2 px-2 py-1 rounded text-[9px] font-medium pointer-events-none"
              style={{ background: "rgba(0,0,0,0.75)", color: "var(--accent)" }}
            >
              FFmpeg (drawtext)
            </div>
          </div>
        )}

        {showFfmpegPreview && ffmpegPreviewUrl && (
          <div
            className="absolute top-2 left-1/2 -translate-x-1/2 z-[26] flex items-center gap-0.5 px-1 py-1 rounded"
            style={{ background: "rgba(0,0,0,0.82)", border: "1px solid rgba(255,255,255,0.12)" }}
          >
            {[
              { id: "css", label: "CSS" },
              { id: "ffmpeg", label: "FFmpeg" },
              { id: "split", label: "Lado a lado" },
            ].map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => setPreviewCompareMode(id)}
                className="px-2 py-0.5 rounded text-[9px] font-medium transition-colors"
                style={{
                  background: previewCompareMode === id ? "var(--accent)" : "transparent",
                  color: previewCompareMode === id ? "var(--bg-app)" : "var(--text-secondary)",
                }}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              onClick={dismissFfmpegPreview}
              className="p-0.5 ml-0.5 rounded hover:bg-white/10"
              style={{ color: "var(--text-dim)" }}
              title="Cerrar comparación"
            >
              <X size={12} />
            </button>
          </div>
        )}
      </div>

      {/* Video Player Controls */}
      <div
        className="absolute bottom-0 left-0 right-0 z-30"
        style={{ background: "linear-gradient(transparent, rgba(0,0,0,0.85))", paddingTop: "24px" }}
      >
        {/* Seek bar with timeline markers */}
        <div className="px-3 pb-1 relative">
          {showTimeline &&
            duration > 0 &&
            sel.operations.some((op) => op.startTime != null || op.endTime != null) && (
              <div className="absolute left-3 right-3 top-1/2 -translate-y-1/2 h-3 pointer-events-none z-10">
                {sel.operations.map((op) => {
                  const s = op.startTime ?? 0;
                  const e = op.endTime ?? duration;
                  const left = (s / duration) * 100;
                  const width = Math.max(0.5, ((e - s) / duration) * 100);
                  return (
                    <div
                      key={op.id}
                      className="absolute h-1 rounded-sm"
                      style={{
                        left: `${left}%`,
                        width: `${width}%`,
                        top: "50%",
                        transform: "translateY(-50%)",
                        background: opModeColor[op.mode] || "#888",
                        opacity: isOpActive(op, currentTime) ? 0.85 : 0.25,
                      }}
                      title={`${op.mode} ${fmtTime(s)} → ${fmtTime(e)}`}
                    />
                  );
                })}
              </div>
            )}
          <input
            type="range"
            min={0}
            max={1}
            step={0.001}
            value={seekFrac}
            disabled={duration <= 0}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture?.(e.pointerId);
              setSeeking(true);
            }}
            onPointerUp={() => setSeeking(false)}
            onPointerCancel={() => setSeeking(false)}
            onChange={(e) => {
              const frac = parseFloat(e.target.value);
              if (duration <= 0) return;
              setCurrentTime(frac * duration);
              seekTo(frac);
            }}
            className="w-full h-1 rounded-full appearance-none cursor-pointer relative z-20"
            style={{
              accentColor: "var(--accent)",
              background: `linear-gradient(to right, var(--accent) ${seekFrac * 100}%, var(--border) ${seekFrac * 100}%)`,
            }}
          />
        </div>
        {/* Buttons & time */}
        <div className="flex items-center gap-2 px-3 pb-2">
          <button
            onClick={() => {
              const v = videoRef.current;
              if (v) v.currentTime = 0;
            }}
            className="p-1 rounded hover:bg-white/10"
            style={{ color: "var(--text-dim)" }}
          >
            <SkipBack size={14} />
          </button>
          <button
            onClick={() => {
              const v = videoRef.current;
              if (!v) return;
              if (v.paused) v.play();
              else v.pause();
            }}
            className="p-1.5 rounded-full hover:bg-white/15"
            style={{ color: "var(--accent)" }}
          >
            {playing ? <Pause size={16} /> : <Play size={16} />}
          </button>
          <button
            onClick={() => {
              const v = videoRef.current;
              const d = resolvedDuration(v, sel?.duration);
              if (v && d) v.currentTime = d;
            }}
            className="p-1 rounded hover:bg-white/10"
            style={{ color: "var(--text-dim)" }}
          >
            <SkipForward size={14} />
          </button>
          <button
            onClick={() => {
              const v = videoRef.current;
              if (v) {
                v.muted = !v.muted;
                setMuted(v.muted);
              }
            }}
            className="p-1 rounded hover:bg-white/10"
            style={{ color: "var(--text-dim)" }}
          >
            {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
          </button>
          <button
            onClick={() => setShowTimeline((v) => !v)}
            className="p-1 rounded hover:bg-white/10"
            style={{ color: showTimeline ? "var(--accent)" : "var(--text-dim)" }}
            title={showTimeline ? "Ocultar marcadores de tiempo" : "Mostrar marcadores de tiempo"}
          >
            {showTimeline ? <Eye size={14} /> : <EyeOff size={14} />}
          </button>
          <button
            onClick={handleRenderPreviewFrame}
            disabled={ffmpegPreviewLoading}
            className="p-1 rounded hover:bg-white/10 disabled:opacity-40"
            style={{
              color: showFfmpegPreview ? "var(--accent)" : "var(--text-dim)",
            }}
            title="Previsualizar frame renderizado (FFmpeg drawtext)"
          >
            {ffmpegPreviewLoading ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <ScanEye size={14} />
            )}
          </button>
          <span className="text-[10px] font-mono ml-1" style={{ color: "var(--text-secondary)" }}>
            {fmtTime(currentTime)} / {fmtTime(duration)}
          </span>
          <div className="flex-1" />
          {!isSplitCompare && (
            <div
              className="flex items-center gap-0.5 px-1 py-0.5 rounded"
              style={{ background: "rgba(0,0,0,0.4)" }}
            >
              <button
                type="button"
                onClick={zoomOut}
                disabled={zoom <= MIN_ZOOM}
                className="p-0.5 rounded hover:bg-white/10 disabled:opacity-30"
                style={{ color: "var(--text-dim)" }}
                title="Alejar (Ctrl + rueda)"
              >
                <ZoomOut size={13} />
              </button>
              <button
                type="button"
                onClick={zoomReset}
                className="px-1.5 py-0.5 rounded text-[9px] font-mono hover:bg-white/10 min-w-[40px] text-center"
                style={{ color: zoom > 1 ? "var(--accent)" : "var(--text-dim)" }}
                title="Restablecer zoom (1:1)"
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                type="button"
                onClick={zoomIn}
                disabled={zoom >= MAX_ZOOM}
                className="p-0.5 rounded hover:bg-white/10 disabled:opacity-30"
                style={{ color: "var(--text-dim)" }}
                title="Acercar (Ctrl + rueda)"
              >
                <ZoomIn size={13} />
              </button>
            </div>
          )}
          <span className="text-[9px] font-mono" style={{ color: "var(--text-dim)" }}>
            {sel.width}×{sel.height}
          </span>
        </div>
      </div>
    </div>
  );
}
