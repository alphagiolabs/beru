import { useRef, useEffect, useCallback, useMemo } from "react";
import { shallow } from "zustand/shallow";
import useEditorStore from "../stores/useEditorStore";
import useCanvas from "../hooks/useCanvas";
import useRegionGesture from "../hooks/useRegionGesture";
import { regionToScreen, isRegionUsable } from "../utils/video-utils";
import DelogoLivePreview from "./DelogoLivePreview";
import Landing from "./Landing";
import TextRegionFrame from "./TextRegionFrame";
import { useT } from "../i18n/useT";
import { getGlobalTextStyleFromState } from "../utils/text-style";
import { opModeColor, isPreviewOpActive, REGION_EDIT_LABEL } from "./video-preview/utils";
import useZoomPan from "./video-preview/useZoomPan";
import useVideoPreviewLifecycle from "./video-preview/useVideoPreviewLifecycle";
import useFfmpegPreview from "./video-preview/useFfmpegPreview";
import useOperationDrag from "./video-preview/useOperationDrag";
import LogoTimeline from "./video-preview/LogoTimeline";
import MediaControls from "./video-preview/MediaControls";
import OperationOverlays from "./video-preview/OperationOverlays";
import LogoDraftOverlays from "./video-preview/LogoDraftOverlays";
import BatchOverlays from "./video-preview/BatchOverlays";
import WatermarkOverlay from "./video-preview/WatermarkOverlay";
import FfmpegOverlay from "./video-preview/FfmpegOverlay";
import VideoErrorOverlay from "./video-preview/VideoErrorOverlay";
import SplitComparePane from "./video-preview/SplitComparePane";
import PreviewCompareBar from "./video-preview/PreviewCompareBar";
import ZoomControls from "./video-preview/ZoomControls";

export default function VideoPreview() {
  const t = useT();
  const sel = useEditorStore(
    (s) => (s.selectedIdx >= 0 && s.selectedIdx < s.queue.length ? s.queue[s.selectedIdx] : null),
    shallow,
  );
  const {
    selectedIdx,
    sidebarMode,
    activeTool,
    currentRegion,
    textInput,
    blurStrength,
    tempStart,
    tempEnd,
    undoStack,
    redoStack,
    imageDataCache,
    templateRegions,
    selectedTemplateRegionId,
    watermark,
    selectedOperationIdx,
  } = useEditorStore(
    (s) => ({
      selectedIdx: s.selectedIdx,
      sidebarMode: s.sidebarMode,
      activeTool: s.activeTool,
      currentRegion: s.currentRegion,
      textInput: s.textInput,
      blurStrength: s.blurStrength,
      tempStart: s.tempStart,
      tempEnd: s.tempEnd,
      undoStack: s.undoStack,
      redoStack: s.redoStack,
      imageDataCache: s.imageDataCache,
      templateRegions: s.templateRegions,
      selectedTemplateRegionId: s.selectedTemplateRegionId,
      watermark: s.watermark,
      selectedOperationIdx: s.selectedOperationIdx,
    }),
    shallow,
  );
  const getBatchPreviewPayload = useEditorStore((s) => s.getBatchPreviewPayload);
  const globalTextStyle = useEditorStore(getGlobalTextStyleFromState, shallow);
  const videoRef = useRef(null);
  const {
    timeEpoch,
    currentTimeRef,
    duration,
    trimStart,
    trimEnd,
    videoError,
    layoutTick,
    videoHandlers,
  } = useVideoPreviewLifecycle({ videoRef, sel, sidebarMode });

  const { canvasRef, onMouseDown, onMouseMove, onMouseUp } = useCanvas(videoRef, sel?.path);

  const opsWithScreen = useMemo(() => {
    if (!sel?.operations) return [];
    const videoEl = videoRef.current;
    return sel.operations.map((op, opIdx) => ({
      op,
      opIdx,
      screen: regionToScreen(op.region, videoEl),
    }));
  }, [sel?.operations, layoutTick]);

  const activeOpsWithScreen = useMemo(
    () =>
      opsWithScreen.filter(({ op }) => isPreviewOpActive(op, currentTimeRef.current, sidebarMode)),
    [opsWithScreen, timeEpoch, sidebarMode, currentTimeRef],
  );

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
  }, [
    sidebarMode,
    selectedIdx,
    templateRegions,
    sel,
    globalTextStyle,
    layoutTick,
    getBatchPreviewPayload,
  ]);

  const {
    ffmpegPreviewUrl,
    ffmpegPreviewLoading,
    ffmpegPreviewError,
    ffmpegPreviewArtifact,
    ffmpegPreviewStale,
    showFfmpegPreview,
    previewCompareMode,
    setPreviewCompareMode,
    beginLogoGesture,
    isSplitCompare,
    showFfmpegOverlay,
    logoComparisonVisible,
    toggleRenderFrame,
    dismissFfmpegPreview,
  } = useFfmpegPreview({ videoRef, sel, sidebarMode });

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
    setZoomBoth,
    setPanBoth,
  } = useZoomPan(videoRef, isSplitCompare, { panToolActive: activeTool === "pan" });
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

  const {
    draggingOp,
    draggingBatchText,
    handleImageDragStart,
    handleRegionOpDragStart,
    handleBatchTextDragStart,
    selectedRegionOp,
    selectedRegionOpScreen,
    selectedRegionOpGestureWrapped,
  } = useOperationDrag({
    videoRef,
    sel,
    sidebarMode,
    activeTool,
    currentRegion,
    selectedOperationIdx,
    showFfmpegPreview,
    showFfmpegOverlay,
    layoutTick,
  });

  useEffect(() => {
    setZoomBoth(1);
    setPanBoth({ x: 0, y: 0 });
  }, [sel?.path, setZoomBoth, setPanBoth]);

  if (!sel) {
    return (
      <div className="flex-1 flex min-h-0 min-w-0 w-full">
        <Landing />
      </div>
    );
  }

  const isLogoMode = sidebarMode === "logo";
  const videoMaxH = isLogoMode ? "max-h-[calc(100vh-330px)]" : "max-h-[calc(100vh-200px)]";

  const previewZoomControls = !isSplitCompare && (
    <ZoomControls zoom={zoom} zoomIn={zoomIn} zoomOut={zoomOut} zoomReset={zoomReset} />
  );

  return (
    <div className={`video-editor${isLogoMode ? " video-editor--logo" : ""}`}>
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
              ? { maxHeight: isLogoMode ? "calc(100vh - 330px)" : "calc(100vh - 200px)" }
              : {
                  maxWidth: "100%",
                  maxHeight: "100%",
                  overflow: zoom > 1 ? "visible" : "hidden",
                  transform: `translate(${pan.x}px, ${pan.y}px)`,
                }
          }
        >
          <div
            className={
              isSplitCompare ? "relative flex-1 min-w-0 self-center" : "relative inline-block"
            }
            onMouseDownCapture={(event) => {
              if (event.button === 0) beginLogoGesture();
            }}
            style={
              isSplitCompare ? undefined : { transform: `scale(${zoom})`, transformOrigin: "0 0" }
            }
          >
            {isSplitCompare && (
              <div
                className="absolute top-2 left-2 z-[26] px-2 py-1 rounded text-[9px] font-medium pointer-events-none"
                style={{ background: "var(--overlay)", color: "var(--text-secondary)" }}
              >
                {sidebarMode === "logo" ? t("logo.before") : "CSS"}
              </div>
            )}
            <video
              ref={videoRef}
              src={sel.src || null}
              className={`${videoMaxH} max-w-full block object-contain rounded`}
              style={{ imageRendering: "auto" }}
              preload="metadata"
              playsInline
              disablePictureInPicture
              controlsList="nodownload noplaybackrate"
              onLoadedMetadata={videoHandlers.onLoadedMetadata}
              onError={videoHandlers.onError}
            />

            {showFfmpegOverlay && (
              <FfmpegOverlay
                url={ffmpegPreviewUrl}
                stale={ffmpegPreviewStale}
                artifact={ffmpegPreviewArtifact}
              />
            )}

            <VideoErrorOverlay
              videoError={videoError}
              ffmpegPreviewError={ffmpegPreviewError}
              sidebarMode={sidebarMode}
            />

            <OperationOverlays
              ops={activeOpsWithScreen}
              videoRef={videoRef}
              currentTimeRef={currentTimeRef}
              sidebarMode={sidebarMode}
              activeTool={activeTool}
              selectedOperationIdx={selectedOperationIdx}
              draggingOp={draggingOp}
              showFfmpegPreview={showFfmpegPreview}
              showFfmpegOverlay={showFfmpegOverlay}
              logoComparisonVisible={logoComparisonVisible}
              currentRegion={currentRegion}
              imageDataCache={imageDataCache}
              onRegionOpDragStart={handleRegionOpDragStart}
              onImageDragStart={handleImageDragStart}
            />

            <LogoDraftOverlays
              sidebarMode={sidebarMode}
              activeTool={activeTool}
              currentRegion={currentRegion}
              showFfmpegOverlay={showFfmpegOverlay}
              videoRef={videoRef}
              blurStrength={blurStrength}
              tempStart={tempStart}
              tempEnd={tempEnd}
              textInput={textInput}
              globalTextStyle={globalTextStyle}
            />

            <BatchOverlays
              sidebarMode={sidebarMode}
              selectedIdx={selectedIdx}
              currentRegion={currentRegion}
              showFfmpegOverlay={showFfmpegOverlay}
              showFfmpegPreview={showFfmpegPreview}
              videoRef={videoRef}
              globalTextStyle={globalTextStyle}
              batchRegionPreviews={batchRegionPreviews}
              selectedTemplateRegionId={selectedTemplateRegionId}
              draggingBatchText={draggingBatchText}
              textSelectionActive={textSelectionActive}
              textGestureActive={textRegionGesture.active}
              onBatchTextDragStart={handleBatchTextDragStart}
            />

            {watermark?.enabled && !showFfmpegOverlay && !logoComparisonVisible && (
              <WatermarkOverlay watermark={watermark} videoRef={videoRef} />
            )}

            {!logoComparisonVisible && !showFfmpegOverlay && (
              <DelogoLivePreview videoRef={videoRef} />
            )}

            <canvas
              ref={canvasRef}
              className="absolute inset-0 w-full h-full"
              style={{
                cursor: activeTool === "pan" && zoom > 1 ? "grab" : undefined,
                zIndex: 30,
                pointerEvents:
                  activeTool === "pan" || (showFfmpegOverlay && sidebarMode !== "logo")
                    ? "none"
                    : "auto",
                opacity: showFfmpegOverlay ? 0 : 1,
              }}
              onMouseDown={(event) => {
                onMouseDown(event);
              }}
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
                  sidebarMode === "batch"
                    ? "var(--purple, #a855f7)"
                    : "var(--accent-brand, #00b4b0)"
                }
                zIndex={50}
              />
            )}

            {selectedRegionOp && selectedRegionOpScreen && (
              <TextRegionFrame
                screen={selectedRegionOpScreen}
                region={selectedRegionOp.op.region}
                gesture={selectedRegionOpGestureWrapped}
                label={
                  REGION_EDIT_LABEL[selectedRegionOp.op.mode]
                    ? t(REGION_EDIT_LABEL[selectedRegionOp.op.mode])
                    : selectedRegionOp.op.mode
                }
                color={opModeColor[selectedRegionOp.op.mode] || "var(--rose, #f43f5e)"}
                zIndex={45}
              />
            )}
          </div>

          {isSplitCompare && (
            <SplitComparePane
              url={ffmpegPreviewUrl}
              videoMaxH={videoMaxH}
              sidebarMode={sidebarMode}
              artifact={ffmpegPreviewArtifact}
            />
          )}

          {showFfmpegPreview && ffmpegPreviewUrl && (
            <PreviewCompareBar
              sidebarMode={sidebarMode}
              compareMode={previewCompareMode}
              onSelectMode={setPreviewCompareMode}
              onDismiss={dismissFfmpegPreview}
            />
          )}
        </div>

        {isLogoMode ? (
          <div
            className={`logo-stage-overlay absolute bottom-3 right-3 z-30 flex items-center gap-2${zoom > 1 ? " is-visible" : ""}`}
          >
            {previewZoomControls}
            <span className="logo-stage-dims">
              {sel.width}×{sel.height}
            </span>
          </div>
        ) : (
          <MediaControls
            videoRef={videoRef}
            videoKey={sel.path}
            duration={duration}
            operations={sel.operations}
            renderLoading={ffmpegPreviewLoading}
            renderActive={showFfmpegPreview}
            onToggleRender={toggleRenderFrame}
            zoomControls={previewZoomControls}
            width={sel.width}
            height={sel.height}
          />
        )}
      </div>
      {isLogoMode && (
        <LogoTimeline
          sel={sel}
          videoRef={videoRef}
          videoIdx={selectedIdx}
          duration={duration}
          trimStart={trimStart}
          trimEnd={trimEnd}
          canUndo={undoStack.length > 0}
          canRedo={redoStack.length > 0}
          selectedOperationIdx={selectedOperationIdx}
          renderLoading={ffmpegPreviewLoading}
          renderActive={showFfmpegPreview}
          onToggleRender={toggleRenderFrame}
        />
      )}
    </div>
  );
}
