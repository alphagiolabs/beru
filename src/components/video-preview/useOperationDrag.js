import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useEditorStore from "../../stores/useEditorStore";
import useRegionGesture from "../../hooks/useRegionGesture";
import { regionToScreen } from "../../utils/video-utils";
import { getContentPx } from "../../utils/region-interaction";
import { REGION_EDIT_MODES } from "./utils";

export default function useOperationDrag({
  videoRef,
  sel,
  sidebarMode,
  activeTool,
  currentRegion,
  selectedOperationIdx,
  showFfmpegPreview,
  showFfmpegOverlay,
  layoutTick,
}) {
  const updateOperationRegion = useEditorStore((s) => s.updateOperationRegion);
  const [draggingOp, setDraggingOp] = useState(null);
  const [dragStart, setDragStart] = useState(null);
  const [draggingBatchText, setDraggingBatchText] = useState(null);
  const [batchTextDragStart, setBatchTextDragStart] = useState(null);
  const draggingRef = useRef({ image: null, batch: null });

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
    if (
      currentRegion ||
      selectedOperationIdx == null ||
      showFfmpegOverlay ||
      (showFfmpegPreview && sidebarMode !== "logo") ||
      activeTool === "pan"
    )
      return null;
    const op = sel?.operations?.[selectedOperationIdx];
    if (!op || !op.region || !REGION_EDIT_MODES.has(op.mode)) return null;
    return { op, opIdx: selectedOperationIdx };
  }, [
    sel?.operations,
    selectedOperationIdx,
    currentRegion,
    showFfmpegPreview,
    sidebarMode,
    activeTool,
  ]);

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
  }, [selectedRegionOp, layoutTick, videoRef]);

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
    const opIdx = state.setTextForRegion(videoIdx, tr.id);
    const op = opIdx >= 0 ? useEditorStore.getState().queue[videoIdx]?.operations?.[opIdx] : null;
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
    let raf = 0;
    let pending = null;
    const flush = () => {
      raf = 0;
      const e = pending;
      pending = null;
      if (!e) return;
      draggingRef.current.image?.move(e);
      draggingRef.current.batch?.move(e);
    };
    const onMouseMove = (e) => {
      pending = { clientX: e.clientX, clientY: e.clientY };
      if (raf) return;
      raf = requestAnimationFrame(flush);
    };
    const onMouseUp = () => {
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      flush();
      draggingRef.current.image?.end();
      draggingRef.current.batch?.end();
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return {
    draggingOp,
    draggingBatchText,
    handleImageDragStart,
    handleRegionOpDragStart,
    handleBatchTextDragStart,
    selectedRegionOp,
    selectedRegionOpScreen,
    selectedRegionOpGestureWrapped,
  };
}
