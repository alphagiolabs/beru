import { useRef, useEffect, useState, useCallback, useMemo, Fragment } from "react";
import { shallow } from "zustand/shallow";
import useEditorStore from "../stores/useEditorStore";
import useCanvas from "../hooks/useCanvas";
import useRegionGesture from "../hooks/useRegionGesture";
import { regionToScreen, fmtTime, isRegionUsable } from "../utils/video-utils";
import { getContentPx } from "../utils/region-interaction";
import DelogoLivePreview from "./DelogoLivePreview";
import Landing from "./Landing";
import TextOverlay from "./TextOverlay";
import TextRegionFrame from "./TextRegionFrame";
import RegionBlurPreview from "./video-preview/RegionBlurPreview";
import { useT } from "../i18n/useT";
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
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Button } from "./ui/Button";
import {
  opModeColor,
  isOpActive,
  resolvedDuration,
  MIN_ZOOM,
  MAX_ZOOM,
} from "./video-preview/utils";
import useZoomPan from "./video-preview/useZoomPan";

const REGION_EDIT_MODES = new Set(["blur", "delogo", "crop"]);

const REGION_EDIT_LABEL = {
  blur: "Desenfoque",
  delogo: "Quitar logo",
  crop: "Recorte",
};

function RegionHitLayer({ screen, selected, dragging, disabled, onDragStart }) {
  if (!screen || disabled) return null;
  return (
    <div
      className={`absolute ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
      style={{
        left: screen.x,
        top: screen.y,
        width: screen.w,
        height: screen.h,
        zIndex: 40,
        pointerEvents: "auto",
        background: "transparent",
        outline: selected ? "none" : "1px dashed transparent",
      }}
      onMouseDown={onDragStart}
      title="Arrastra para mover. Usa las esquinas para redimensionar."
    />
  );
}

export default function VideoPreview() {
  const t = useT();
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
    selectedOperationIdx,
  } = useEditorStore((s) => {
    const item =
      s.selectedIdx >= 0 && s.selectedIdx < s.queue.length ? s.queue[s.selectedIdx] : null;
    const sel = item
      ? {
          path: item.path,
          src: item.src,
          filename: item.filename,
          width: item.width,
          height: item.height,
          duration: item.duration,
          operations: item.operations,
          customOutputName: item.customOutputName,
        }
      : null;
    return {
      selectedIdx: s.selectedIdx,
      sel,
      sidebarMode: s.sidebarMode,
      activeTool: s.activeTool,
      currentRegion: s.currentRegion,
      textInput: s.textInput,
      blurStrength: s.blurStrength,
      imageDataCache: s.imageDataCache,
      templateRegions: s.templateRegions,
      selectedTemplateRegionId: s.selectedTemplateRegionId,
      watermark: s.watermark,
      selectedOperationIdx: s.selectedOperationIdx,
    };
  }, shallow);
  const {
    setCurrentRegion,
    updateOperationRegion,
    getBatchPreviewPayload,
    buildPreviewFrameJob,
    showToast,
  } = useEditorStore(
    (s) => ({
      setCurrentRegion: s.setCurrentRegion,
      updateOperationRegion: s.updateOperationRegion,
      getBatchPreviewPayload: s.getBatchPreviewPayload,
      buildPreviewFrameJob: s.buildPreviewFrameJob,
      showToast: s.showToast,
    }),
    shallow,
  );
  const globalTextStyle = useEditorStore(
    (s) =>
      getGlobalTextStyleFromState({
        textFontSize: s.textFontSize,
        textFontColor: s.textFontColor,
        fontFamily: s.fontFamily,
        fontWeight: s.fontWeight,
        letterSpacing: s.letterSpacing,
        textAlign: s.textAlign,
        textOpacity: s.textOpacity,
        bold: s.bold,
        italic: s.italic,
        bgEnabled: s.bgEnabled,
        bgColor: s.bgColor,
        bgOpacity: s.bgOpacity,
        boxBorderWidth: s.boxBorderWidth,
        borderWidth: s.borderWidth,
        borderColor: s.borderColor,
        textShadowEnabled: s.textShadowEnabled,
        textShadowColor: s.textShadowColor,
        textShadowOffsetX: s.textShadowOffsetX,
        textShadowOffsetY: s.textShadowOffsetY,
        autoFit: s.autoFit,
        lineHeight: s.lineHeight,
        verticalAlign: s.verticalAlign,
        textWrap: s.textWrap,
        safeMargin: s.safeMargin,
        truncate: s.truncate,
      }),
    shallow,
  );
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
  const [layoutTick, setLayoutTick] = useState(0);
  const draggingRef = useRef({ image: null, batch: null });
  const [videoError, setVideoError] = useState(null);
  const [ffmpegPreviewUrl, setFfmpegPreviewUrl] = useState(null);
  const [ffmpegPreviewLoading, setFfmpegPreviewLoading] = useState(false);
  const ffmpegPreviewGenRef = useRef(0);
  const [showFfmpegPreview, setShowFfmpegPreview] = useState(false);
  const [previewCompareMode, setPreviewCompareMode] = useState("ffmpeg");
  const { canvasRef, onMouseDown, onMouseMove, onMouseUp } = useCanvas(videoRef);

  const activeOpsWithScreen = useMemo(() => {
    if (!sel?.operations) return [];
    const videoEl = videoRef.current;
    const out = [];
    for (let i = 0; i < sel.operations.length; i++) {
      const op = sel.operations[i];
      if (!isOpActive(op, currentTime)) continue;
      const screen = regionToScreen(op.region, videoEl);
      out.push({ op, opIdx: i, screen });
    }
    return out;
  }, [sel?.operations, layoutTick, currentTime]);

  const batchRegionPreviews = useMemo(() => {
    if (sidebarMode !== "batch" || selectedIdx < 0 || !templateRegions?.length) return [];
    const videoEl = videoRef.current;
    const out = [];
    for (let i = 0; i < templateRegions.length; i++) {
      const tr = templateRegions[i];
      const payload = getBatchPreviewPayload(selectedIdx, tr.id);
      if (!payload) continue;
      const screen = regionToScreen(payload.region, videoEl);
      out.push({ tr, payload, screen });
    }
    return out;
  }, [sidebarMode, selectedIdx, templateRegions, sel, globalTextStyle, layoutTick]);

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
  } = useZoomPan(videoRef, isSplitCompare, { panToolActive: activeTool === "pan" });
  isSplitCompareRef.current = isSplitCompare;
  const showFfmpegOverlay =
    showFfmpegPreview && ffmpegPreviewUrl && previewCompareMode === "ffmpeg";

  const textSelectionActive =
    !!currentRegion &&
    isRegionUsable(currentRegion) &&
    !showFfmpegPreview &&
    activeTool !== "pan" &&
    (sidebarMode === "batch" || activeTool === "text");

  const previewTextRegion = useCallback((region) => {
    useEditorStore.setState({ currentRegion: region });
  }, []);
  const commitTextRegion = useCallback((region) => {
    useEditorStore.getState().setCurrentRegion(region);
  }, []);
  const textRegionGesture = useRegionGesture({
    videoEl: videoRef,
    enabled: textSelectionActive,
    onChange: previewTextRegion,
    onCommit: commitTextRegion,
  });
  const textSelectionScreen = useMemo(() => {
    if (!textSelectionActive) return null;
    return regionToScreen(currentRegion, videoRef.current);
  }, [textSelectionActive, currentRegion, layoutTick]);
  const textSelectionLabel =
    sidebarMode === "batch" && selectedTemplateRegionId != null
      ? templateRegions?.find((tr) => tr.id === selectedTemplateRegionId)?.label
      : undefined;

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

  const seekingRef = useRef(false);
  seekingRef.current = seeking;
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTimeUpdate = () => {
      if (!seekingRef.current) setCurrentTime(v.currentTime);
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
  }, [sel?.path, sel?.duration]);

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
    ffmpegPreviewGenRef.current += 1;
    setFfmpegPreviewLoading(false);
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

  const handleImageDragStart = (op, opIdx, e) => {
    e.stopPropagation();
    const video = videoRef.current;
    if (!video) return;
    const content = getContentPx(video);
    if (!content) return;
    useEditorStore.getState()._saveUndo?.();
    setDraggingOp({ op, opIdx });
    setDragStart({
      mouseX: e.clientX,
      mouseY: e.clientY,
      regionX: op.region.x,
      regionY: op.region.y,
      contentW: content.width,
      contentH: content.height,
    });
  };

  const handleImageDragMove = useCallback(
    (e) => {
      if (!draggingOp || !dragStart) return;
      const contentW = dragStart.contentW || 1;
      const contentH = dragStart.contentH || 1;
      const normalizedDeltaX = (e.clientX - dragStart.mouseX) / contentW;
      const normalizedDeltaY = (e.clientY - dragStart.mouseY) / contentH;

      const newX = Math.max(
        0,
        Math.min(1 - draggingOp.op.region.w, dragStart.regionX + normalizedDeltaX),
      );
      const newY = Math.max(
        0,
        Math.min(1 - draggingOp.op.region.h, dragStart.regionY + normalizedDeltaY),
      );

      updateOperationRegion(
        draggingOp.opIdx,
        {
          ...draggingOp.op.region,
          x: newX,
          y: newY,
        },
        { recordHistory: false },
      );
    },
    [draggingOp, dragStart, updateOperationRegion],
  );

  const handleImageDragEnd = useCallback(() => {
    setDraggingOp(null);
    setDragStart(null);
  }, []);

  const handleRegionOpDragStart = (opIdx, e) => {
    e.stopPropagation();
    const video = videoRef.current;
    if (!video || showFfmpegPreview) return;
    const content = getContentPx(video);
    if (!content) return;
    const st = useEditorStore.getState();
    const op = st.queue[st.selectedIdx]?.operations?.[opIdx];
    if (!op?.region) return;
    if (st.selectedOperationIdx !== opIdx) st.selectOperation(opIdx);
    st._saveUndo?.();
    setDraggingOp({ op, opIdx });
    setDragStart({
      mouseX: e.clientX,
      mouseY: e.clientY,
      regionX: op.region.x,
      regionY: op.region.y,
      contentW: content.width,
      contentH: content.height,
    });
  };

  const selectedRegionOp = useMemo(() => {
    if (currentRegion || selectedOperationIdx == null || showFfmpegPreview || activeTool === "pan")
      return null;
    const op = sel?.operations?.[selectedOperationIdx];
    if (!op || !op.region || !REGION_EDIT_MODES.has(op.mode)) return null;
    return { op, opIdx: selectedOperationIdx };
  }, [sel?.operations, selectedOperationIdx, currentRegion, showFfmpegPreview, activeTool]);

  const patchSelectedRegionOp = useCallback((region) => {
    const idx = useEditorStore.getState().selectedOperationIdx;
    if (idx == null) return;
    useEditorStore.getState().updateOperationRegion(idx, region, { recordHistory: false });
  }, []);

  const selectedRegionOpGesture = useRegionGesture({
    videoEl: videoRef,
    enabled: !!selectedRegionOp,
    onChange: patchSelectedRegionOp,
    onCommit: patchSelectedRegionOp,
  });

  const selectedRegionOpGestureWrapped = useMemo(
    () => ({
      ...selectedRegionOpGesture,
      beginMove: (e, region) => {
        useEditorStore.getState()._saveUndo?.();
        selectedRegionOpGesture.beginMove(e, region);
      },
      beginResize: (e, region, handle) => {
        useEditorStore.getState()._saveUndo?.();
        selectedRegionOpGesture.beginResize(e, region, handle);
      },
    }),
    [selectedRegionOpGesture],
  );

  const selectedRegionOpScreen = useMemo(() => {
    if (!selectedRegionOp) return null;
    return regionToScreen(selectedRegionOp.op.region, videoRef.current);
  }, [selectedRegionOp, layoutTick]);

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

    const content = getContentPx(video);
    if (!content) return;

    useEditorStore.getState()._saveUndo?.();
    setDraggingBatchText({ videoIdx, opIdx, regionId: tr.id });
    setBatchTextDragStart({
      mouseX: e.clientX,
      mouseY: e.clientY,
      region: { ...op.region },
      contentW: content.width,
      contentH: content.height,
    });
  };

  const handleBatchTextDragMove = useCallback(
    (e) => {
      if (!draggingBatchText || !batchTextDragStart) return;
      const contentW = batchTextDragStart.contentW || 1;
      const contentH = batchTextDragStart.contentH || 1;

      const startRegion = batchTextDragStart.region;
      const deltaX = (e.clientX - batchTextDragStart.mouseX) / contentW;
      const deltaY = (e.clientY - batchTextDragStart.mouseY) / contentH;
      const nextRegion = {
        ...startRegion,
        x: Math.max(0, Math.min(1 - startRegion.w, startRegion.x + deltaX)),
        y: Math.max(0, Math.min(1 - startRegion.h, startRegion.y + deltaY)),
      };

      useEditorStore
        .getState()
        .updateOperation(
          draggingBatchText.videoIdx,
          draggingBatchText.opIdx,
          { region: nextRegion },
          { recordHistory: false },
        );
      useEditorStore.setState({ currentRegion: nextRegion });
    },
    [draggingBatchText, batchTextDragStart],
  );

  const handleBatchTextDragEnd = useCallback(() => {
    setDraggingBatchText(null);
    setBatchTextDragStart(null);
  }, []);

  draggingRef.current.image = { move: handleImageDragMove, end: handleImageDragEnd };
  draggingRef.current.batch = { move: handleBatchTextDragMove, end: handleBatchTextDragEnd };

  useEffect(() => {
    const onMouseMove = (e) => {
      draggingRef.current.image?.move(e);
      draggingRef.current.batch?.move(e);
    };
    const onMouseUp = () => {
      draggingRef.current.image?.end();
      draggingRef.current.batch?.end();
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  const handleRenderPreviewFrame = useCallback(async () => {
    const api = window.api;
    if (!api?.renderPreviewFrame) {
      showToast?.({ kind: "err", text: "Preview FFmpeg no disponible" });
      return;
    }
    if (selectedIdx < 0 || !sel) {
      showToast?.({ kind: "err", text: "Selecciona un video para previsualizar" });
      return;
    }

    const gen = ++ffmpegPreviewGenRef.current;
    setFfmpegPreviewLoading(true);

    try {
      const video = videoRef.current;
      if (video && !video.paused) video.pause();

      let idx = selectedIdx;
      if (!(sel.width > 0 && sel.height > 0) && api.getVideoInfo) {
        try {
          await useEditorStore.getState().refreshMissingVideoInfo?.(api);
          if (gen !== ffmpegPreviewGenRef.current) return;
          idx = useEditorStore.getState().selectedIdx;
        } catch {
          if (gen !== ffmpegPreviewGenRef.current) return;
        }
      }

      const ts = video?.currentTime ?? currentTime;
      const job = buildPreviewFrameJob(idx, ts);
      if (!job) {
        if (gen !== ffmpegPreviewGenRef.current) return;
        showToast?.({ kind: "err", text: "No se pudo construir el preview" });
        return;
      }

      const result = await api.renderPreviewFrame(job);
      if (gen !== ffmpegPreviewGenRef.current) return;
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
      if (gen !== ffmpegPreviewGenRef.current) return;
      showToast?.({ kind: "err", text: err.message || "Error al renderizar el frame" });
    } finally {
      if (gen === ffmpegPreviewGenRef.current) {
        setFfmpegPreviewLoading(false);
      }
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
      <div className="flex-1 flex min-h-0 min-w-0 w-full">
        <Landing />
      </div>
    );
  }

  const seekFrac = duration > 0 ? currentTime / duration : 0;

  return (
    <div
      ref={outerRef}
      onMouseDown={onPanMouseDown}
      className="flex-1 flex items-center justify-center p-4 min-h-0 relative overflow-hidden"
      style={{
        cursor: activeTool === "pan" && zoom > 1 ? (isPanning ? "grabbing" : "grab") : "default",
      }}
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
            ? { maxHeight: "calc(100vh - 200px)" }
            : {
                maxWidth: "100%",
                maxHeight: "100%",
                overflow: zoom > 1 ? "visible" : "hidden",
                transform: `translate(${pan.x}px, ${pan.y}px)`,
              }
        }
      >
        {/* Same CSS scale as the picture so DOM handles stay aligned. */}
        <div
          className={
            isSplitCompare ? "relative flex-1 min-w-0 self-center" : "relative inline-block"
          }
          style={
            isSplitCompare ? undefined : { transform: `scale(${zoom})`, transformOrigin: "0 0" }
          }
        >
          {isSplitCompare && (
            <div
              className="absolute top-2 left-2 z-[26] px-2 py-1 rounded text-[9px] font-medium pointer-events-none"
              style={{ background: "var(--overlay)", color: "var(--text-secondary)" }}
            >
              CSS
            </div>
          )}
          <video
            ref={videoRef}
            src={sel.src || null}
            className="max-h-[calc(100vh-200px)] max-w-full block object-contain rounded"
            style={{ imageRendering: "auto" }}
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
            <div className="absolute inset-0 z-[25]">
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
                style={{
                  background: "color-mix(in srgb, var(--rose) 95%, transparent)",
                  color: "var(--text-primary)",
                }}
              >
                No se pudo cargar el video ({videoError}). Si el archivo cambió de ubicación, vuelve
                a importarlo.
              </div>
            </div>
          )}

          {activeOpsWithScreen.map(({ op, opIdx, screen: s }) => {
            if (!s) return null;
            if (op.mode === "blur") {
              const isSelected = selectedOperationIdx === opIdx;
              const isDragging = draggingOp?.opIdx === opIdx;
              return (
                <Fragment key={op.id}>
                  <RegionBlurPreview
                    videoRef={videoRef}
                    region={op.region}
                    blurStrength={op.blurStrength}
                    outline={isSelected ? "none" : "2px solid rgba(0,240,234,0.6)"}
                  />
                  <RegionHitLayer
                    screen={s}
                    selected={isSelected}
                    dragging={isDragging}
                    disabled={showFfmpegPreview || activeTool === "pan"}
                    onDragStart={(e) => handleRegionOpDragStart(opIdx, e)}
                  />
                </Fragment>
              );
            }
            if (op.mode === "crop") {
              const isSelected = selectedOperationIdx === opIdx;
              const isDragging = draggingOp?.opIdx === opIdx;
              return (
                <Fragment key={op.id}>
                  <div
                    className="absolute pointer-events-none z-10"
                    style={{
                      left: s.x,
                      top: s.y,
                      width: s.w,
                      height: s.h,
                      outline: isSelected ? "none" : "2px dashed var(--amber)",
                      outlineOffset: "-1px",
                    }}
                  />
                  <RegionHitLayer
                    screen={s}
                    selected={isSelected}
                    dragging={isDragging}
                    disabled={showFfmpegPreview || activeTool === "pan"}
                    onDragStart={(e) => handleRegionOpDragStart(opIdx, e)}
                  />
                </Fragment>
              );
            }
            if (op.mode === "delogo") {
              const dm = op.delogoMethod || "blur";
              const isSelected = selectedOperationIdx === opIdx;
              const isDragging = draggingOp?.opIdx === opIdx;
              const hitLayer = (
                <RegionHitLayer
                  screen={s}
                  selected={isSelected}
                  dragging={isDragging}
                  disabled={showFfmpegPreview || activeTool === "pan"}
                  onDragStart={(e) => handleRegionOpDragStart(opIdx, e)}
                />
              );
              let overlayStyle = { left: s.x, top: s.y, width: s.w, height: s.h };
              if (dm === "inpaint") {
                overlayStyle.background =
                  "repeating-conic-gradient(rgba(239,68,68,0.15) 0% 25%, transparent 0% 50%) 0 0 / 16px 16px";
                overlayStyle.outline = "2px solid rgba(239,68,68,0.7)";
              } else if (dm === "blur") {
                return (
                  <Fragment key={op.id}>
                    <RegionBlurPreview
                      videoRef={videoRef}
                      region={op.region}
                      blurStrength={op.blurStrength}
                      outline={isSelected ? "none" : "2px dashed rgba(59,130,246,0.7)"}
                    />
                    {hitLayer}
                  </Fragment>
                );
              } else if (dm === "fill") {
                overlayStyle.background = `${op.delogoFillColor || "black"}`;
                overlayStyle.opacity = op.delogoFillOpacity ?? 1;
                overlayStyle.outline = "2px solid rgba(239,68,68,0.6)";
              } else if (dm === "mosaic") {
                overlayStyle.background =
                  "repeating-conic-gradient(rgba(168,85,247,0.18) 0% 25%, transparent 0% 50%) 0 0 / 10px 10px";
                overlayStyle.outline = "2px solid rgba(168,85,247,0.7)";
              } else if (dm === "mirror") {
                overlayStyle.background =
                  "repeating-linear-gradient(90deg, rgba(34,197,94,0.12) 0px, rgba(34,197,94,0.12) 2px, transparent 2px, transparent 8px)";
                overlayStyle.outline = "2px dashed rgba(34,197,94,0.7)";
              } else if (dm === "cover" && op.delogoImagePath) {
                const coverDataUrl = imageDataCache?.[op.delogoImagePath];
                overlayStyle.outline = isSelected ? "none" : "2px solid rgba(16,185,129,0.7)";
                overlayStyle.overflow = "hidden";
                return (
                  <Fragment key={op.id}>
                    <div className="absolute pointer-events-none z-10" style={overlayStyle}>
                      {coverDataUrl ? (
                        <img
                          src={coverDataUrl}
                          alt=""
                          className="w-full h-full"
                          style={{ objectFit: "contain" }}
                          draggable={false}
                        />
                      ) : (
                        <div
                          className="w-full h-full flex items-center justify-center text-[10px]"
                          style={{ background: "rgba(16,185,129,0.10)", color: "#10b981" }}
                        >
                          {op.delogoImagePath.split(/[\\/]/).pop()}
                        </div>
                      )}
                    </div>
                    {hitLayer}
                  </Fragment>
                );
              } else {
                overlayStyle.background =
                  "repeating-linear-gradient(45deg, rgba(239,68,68,0.10) 0px, rgba(239,68,68,0.10) 2px, transparent 2px, transparent 8px)";
                overlayStyle.outline = isSelected ? "none" : "2px dashed rgba(239,68,68,0.6)";
              }
              if (isSelected) overlayStyle.outline = "none";
              return (
                <Fragment key={op.id}>
                  <div className="absolute pointer-events-none z-10" style={overlayStyle} />
                  {hitLayer}
                </Fragment>
              );
            }
            if (op.mode === "image" && op.imagePath) {
              const dataUrl = imageDataCache?.[op.imagePath];
              const isDragging = draggingOp?.opIdx === opIdx;
              return (
                <div
                  key={op.id}
                  className={`absolute z-40 ${isDragging ? "cursor-grabbing" : "cursor-grab hover:cursor-grab"}`}
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
            if (op.mode === "text" && op.text && sidebarMode !== "batch" && !showFfmpegOverlay) {
              const textInteractive = !currentRegion;
              const isDragging = draggingOp?.opIdx === opIdx;
              return (
                <TextOverlay
                  key={op.id}
                  screen={s}
                  text={op.text}
                  style={op}
                  showOutline={!showFfmpegPreview && textInteractive}
                  showOverflowWarning={!showFfmpegPreview}
                  interactive={textInteractive}
                  cursor={textInteractive ? (isDragging ? "grabbing" : "grab") : undefined}
                  zIndex={textInteractive ? 40 : 20}
                  onMouseDown={
                    textInteractive ? (e) => handleImageDragStart(op, opIdx, e) : undefined
                  }
                />
              );
            }
            return null;
          })}

          {sidebarMode === "logo" && activeTool === "blur" && currentRegion && (
            <RegionBlurPreview
              videoRef={videoRef}
              region={currentRegion}
              blurStrength={blurStrength}
              outline="2px solid rgba(0,240,234,0.8)"
            />
          )}

          {sidebarMode === "logo" &&
            activeTool === "text" &&
            currentRegion &&
            isRegionUsable(currentRegion) &&
            (() => {
              const s = regionToScreen(currentRegion, videoRef.current);
              if (!s) return null;
              const draftText = String(textInput ?? "").trim() || "Escribe el texto en el panel…";
              return (
                <TextOverlay
                  screen={s}
                  text={draftText}
                  style={{
                    ...globalTextStyle,
                    autoFit: false,
                    textOpacity: String(textInput ?? "").trim()
                      ? (globalTextStyle.textOpacity ?? 1)
                      : 0.55,
                  }}
                  showOutline={false}
                  showOverflowWarning={false}
                  zIndex={35}
                />
              );
            })()}

          {sidebarMode === "batch" &&
            selectedIdx >= 0 &&
            !showFfmpegOverlay &&
            batchRegionPreviews.map(({ tr, payload, screen: baseScreen }) => {
              const isSelected = selectedTemplateRegionId === tr.id;
              const screen =
                isSelected && currentRegion
                  ? regionToScreen(currentRegion, videoRef.current) || baseScreen
                  : baseScreen;
              if (!screen) return null;
              const isDragging =
                draggingBatchText?.videoIdx === selectedIdx && draggingBatchText.regionId === tr.id;
              const underDomFrame = textSelectionActive && isSelected;
              const batchOverlayInteractive = !underDomFrame;
              const previewText =
                String(payload.text ?? "").trim() || tr.label || "Texto de ejemplo";
              return (
                <TextOverlay
                  key={tr.id}
                  screen={screen}
                  text={previewText}
                  style={payload.style}
                  isFocused={isSelected}
                  showOutline={!showFfmpegPreview && !underDomFrame}
                  label={tr.label}
                  interactive={batchOverlayInteractive}
                  cursor={batchOverlayInteractive ? (isDragging ? "grabbing" : "grab") : undefined}
                  zIndex={underDomFrame ? 45 : 40}
                  showOverflowWarning={!showFfmpegPreview && !textRegionGesture.active}
                  onMouseDown={
                    batchOverlayInteractive ? (e) => handleBatchTextDragStart(tr, e) : undefined
                  }
                />
              );
            })}

          {sidebarMode === "batch" &&
            currentRegion &&
            !selectedTemplateRegionId &&
            isRegionUsable(currentRegion) &&
            !showFfmpegOverlay &&
            (() => {
              const s = regionToScreen(currentRegion, videoRef.current);
              if (!s) return null;
              return (
                <TextOverlay
                  screen={s}
                  text="Texto de ejemplo"
                  style={{ ...globalTextStyle, autoFit: false }}
                  isFocused
                  showOutline={false}
                  showOverflowWarning={false}
                  zIndex={35}
                />
              );
            })()}

          {watermark?.enabled &&
            !showFfmpegOverlay &&
            (() => {
              const video = videoRef.current;
              if (!video) return null;
              const vh = video.videoHeight || 1;
              // Layout size, not getBoundingClientRect: CSS zoom would double-scale.
              const layoutW = video.offsetWidth || 1;
              const layoutH = video.offsetHeight || 1;
              const sy = layoutH / vh;
              const margin = 10;
              const pos = watermark.position || "bottom-right";
              const posMap = {
                "top-left": { left: margin, top: margin },
                "top-center": { left: "50%", top: margin, transform: "translateX(-50%)" },
                "top-right": { right: margin, top: margin },
                "center-left": { left: margin, top: "50%", transform: "translateY(-50%)" },
                center: { left: "50%", top: "50%", transform: "translate(-50%, -50%)" },
                "center-right": { right: margin, top: "50%", transform: "translateY(-50%)" },
                "bottom-left": { left: margin, bottom: margin },
                "bottom-center": {
                  left: "50%",
                  bottom: margin,
                  transform: "translateX(-50%)",
                },
                "bottom-right": { right: margin, bottom: margin },
              };
              // FFmpeg overlay uses H-h-margin. z-35 sits above player controls.
              const posStyle = posMap[pos] || posMap["bottom-right"];
              const boxStyle = {
                position: "absolute",
                left: 0,
                top: 0,
                width: layoutW,
                height: layoutH,
                pointerEvents: "none",
                zIndex: 35,
              };
              if (watermark.type === "text" && watermark.text) {
                const fontSize = Math.max(8, (watermark.fontSize || 18) * sy);
                return (
                  <div className="absolute pointer-events-none z-[35]" style={boxStyle}>
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
                // FFmpeg target_h = 80 * scale in native pixels. sy maps that to screen.
                const baseSize = 80 * sy;
                const scaledSize = baseSize * (watermark.scale || 1);
                return (
                  <div className="absolute pointer-events-none z-[35]" style={boxStyle}>
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

          {!showFfmpegOverlay && <DelogoLivePreview videoRef={videoRef} />}

          <canvas
            ref={canvasRef}
            className="absolute top-0 left-0"
            style={{
              cursor: activeTool === "pan" && zoom > 1 ? "grab" : undefined,
              zIndex: 30,
              pointerEvents: activeTool === "pan" || showFfmpegOverlay ? "none" : "auto",
              opacity: showFfmpegOverlay ? 0 : 1,
            }}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
          />

          {textSelectionActive && textSelectionScreen && (
            <TextRegionFrame
              screen={textSelectionScreen}
              region={currentRegion}
              gesture={textRegionGesture}
              label={textSelectionLabel}
              color={
                sidebarMode === "batch" ? "var(--purple, #a855f7)" : "var(--accent-brand, #00b4b0)"
              }
              zIndex={50}
            />
          )}

          {selectedRegionOp && selectedRegionOpScreen && (
            <TextRegionFrame
              screen={selectedRegionOpScreen}
              region={selectedRegionOp.op.region}
              gesture={selectedRegionOpGestureWrapped}
              label={REGION_EDIT_LABEL[selectedRegionOp.op.mode] || selectedRegionOp.op.mode}
              color={opModeColor[selectedRegionOp.op.mode] || "var(--rose, #f43f5e)"}
              zIndex={45}
            />
          )}
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
              style={{ background: "var(--overlay)", color: "var(--accent)" }}
            >
              FFmpeg (drawtext)
            </div>
          </div>
        )}

        {showFfmpegPreview && ffmpegPreviewUrl && (
          <div
            className="absolute top-2 left-1/2 -translate-x-1/2 z-[35] flex items-center gap-0.5 px-1 py-1 rounded"
            style={{ background: "rgba(0,0,0,0.82)", border: "1px solid rgba(255,255,255,0.12)" }}
          >
            {[
              { id: "css", label: "CSS" },
              { id: "ffmpeg", label: "FFmpeg" },
              { id: "split", label: "Lado a lado" },
            ].map(({ id, label }) => (
              <Button
                key={id}
                type="button"
                variant="tertiary"
                size="sm"
                onClick={() => setPreviewCompareMode(id)}
                className="video-preview-compare-btn !h-6 !min-h-6 !rounded !px-2 !text-[9px]"
                aria-pressed={previewCompareMode === id}
                style={{
                  background: previewCompareMode === id ? "var(--accent)" : "transparent",
                  color: previewCompareMode === id ? "var(--bg-app)" : "var(--text-secondary)",
                }}
              >
                {label}
              </Button>
            ))}
            <Button
              type="button"
              variant="tertiary"
              size="icon"
              className="video-preview-icon-btn video-preview-compare-close !ml-0.5 !h-6 !min-h-6 !w-6 !min-w-6 !p-0"
              onClick={dismissFfmpegPreview}
              style={{ color: "var(--text-dim)" }}
              title={t("preview.closeRenderFrame")}
              aria-label={t("preview.closeRenderFrame")}
            >
              <X size={12} />
            </Button>
          </div>
        )}
      </div>

      <div
        className="absolute bottom-0 left-0 right-0 z-30"
        style={{ background: "linear-gradient(transparent, rgba(0,0,0,0.85))", paddingTop: "24px" }}
      >
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
        <div className="flex items-center gap-2 px-3 pb-2">
          <Button
            type="button"
            variant="tertiary"
            size="icon"
            className="video-preview-icon-btn !h-7 !min-h-7 !w-7 !min-w-7 !p-0"
            onClick={() => {
              const v = videoRef.current;
              if (v) v.currentTime = 0;
            }}
            style={{ color: "var(--text-dim)" }}
            title={t("preview.jumpStart")}
            aria-label={t("preview.jumpStart")}
          >
            <SkipBack size={14} />
          </Button>
          <Button
            type="button"
            variant="tertiary"
            size="icon"
            className="video-preview-icon-btn video-preview-play-btn !h-7 !min-h-7 !w-7 !min-w-7 !p-0 !rounded-full"
            onClick={() => {
              const v = videoRef.current;
              if (!v) return;
              if (v.paused) v.play();
              else v.pause();
            }}
            style={{ color: "var(--accent)" }}
            title={t("preview.playPause")}
            aria-label={t("preview.playPause")}
          >
            {playing ? <Pause size={16} /> : <Play size={16} />}
          </Button>
          <Button
            type="button"
            variant="tertiary"
            size="icon"
            className="video-preview-icon-btn !h-7 !min-h-7 !w-7 !min-w-7 !p-0"
            onClick={() => {
              const v = videoRef.current;
              const d = resolvedDuration(v, sel?.duration);
              if (v && d) v.currentTime = d;
            }}
            style={{ color: "var(--text-dim)" }}
            title={t("preview.jumpEnd")}
            aria-label={t("preview.jumpEnd")}
          >
            <SkipForward size={14} />
          </Button>
          <Button
            type="button"
            variant="tertiary"
            size="icon"
            className="video-preview-icon-btn !h-7 !min-h-7 !w-7 !min-w-7 !p-0"
            onClick={() => {
              const v = videoRef.current;
              if (v) {
                v.muted = !v.muted;
                setMuted(v.muted);
              }
            }}
            style={{ color: "var(--text-dim)" }}
            title={muted ? t("preview.unmute") : t("preview.mute")}
            aria-label={muted ? t("preview.unmute") : t("preview.mute")}
          >
            {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
          </Button>
          <Button
            type="button"
            variant="tertiary"
            size="icon"
            className="video-preview-icon-btn !h-7 !min-h-7 !w-7 !min-w-7 !p-0"
            onClick={() => setShowTimeline((v) => !v)}
            style={{ color: showTimeline ? "var(--accent)" : "var(--text-dim)" }}
            title={showTimeline ? t("preview.hideTimeline") : t("preview.showTimeline")}
            aria-label={showTimeline ? t("preview.hideTimeline") : t("preview.showTimeline")}
          >
            {showTimeline ? <Eye size={14} /> : <EyeOff size={14} />}
          </Button>
          <Button
            type="button"
            variant="tertiary"
            size="icon"
            loading={ffmpegPreviewLoading}
            onClick={(e) => {
              e.stopPropagation();
              if (showFfmpegPreview && !ffmpegPreviewLoading) {
                dismissFfmpegPreview();
                return;
              }
              handleRenderPreviewFrame();
            }}
            className="video-preview-icon-btn !h-7 !min-h-7 !w-7 !min-w-7 !p-0"
            style={{
              color: showFfmpegPreview ? "var(--accent)" : "var(--text-dim)",
            }}
            title={showFfmpegPreview ? t("preview.closeRenderFrame") : t("preview.renderFrame")}
            aria-label={
              showFfmpegPreview ? t("preview.closeRenderFrame") : t("preview.renderFrame")
            }
            aria-pressed={showFfmpegPreview}
          >
            {!ffmpegPreviewLoading && <ScanEye size={14} />}
          </Button>
          <span className="text-[10px] font-mono ml-1" style={{ color: "var(--text-secondary)" }}>
            {fmtTime(currentTime)} / {fmtTime(duration)}
          </span>
          <div className="flex-1" />
          {!isSplitCompare && (
            <div
              className="flex items-center gap-1 px-1.5 py-1 rounded-lg border border-white/10 shadow-sm backdrop-blur-md transition-all"
              style={{ background: "rgba(0,0,0,0.5)" }}
            >
              <Button
                type="button"
                variant="tertiary"
                size="icon"
                className="video-preview-icon-btn !h-7 !min-h-7 !w-7 !min-w-7 !p-0"
                onClick={zoomOut}
                disabled={zoom <= MIN_ZOOM}
                style={{ color: "var(--text-secondary, #a3a3a3)" }}
                title={t("preview.zoomOut")}
                aria-label={t("preview.zoomOut")}
              >
                <ZoomOut size={14} />
              </Button>

              <div className="w-[1px] h-3 bg-white/10 mx-0.5"></div>

              <Button
                type="button"
                variant="tertiary"
                size="sm"
                onClick={zoomReset}
                className="video-preview-zoom-reset !h-7 !min-h-7 !min-w-[48px] !px-2 !py-0.5 !text-[10px] !font-mono !font-medium"
                style={{ color: zoom > 1 ? "var(--accent)" : "var(--text-secondary, #a3a3a3)" }}
                title={t("preview.zoomReset")}
                aria-label={t("preview.zoomReset")}
              >
                {Math.round(zoom * 100)}%
              </Button>

              <div className="w-[1px] h-3 bg-white/10 mx-0.5"></div>

              <Button
                type="button"
                variant="tertiary"
                size="icon"
                className="video-preview-icon-btn !h-7 !min-h-7 !w-7 !min-w-7 !p-0"
                onClick={zoomIn}
                disabled={zoom >= MAX_ZOOM}
                style={{ color: "var(--text-secondary, #a3a3a3)" }}
                title={t("preview.zoomIn")}
                aria-label={t("preview.zoomIn")}
              >
                <ZoomIn size={14} />
              </Button>
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
