import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useEditorStore from "../../stores/useEditorStore";
import useRegionGesture from "../../hooks/useRegionGesture";
import { isInOutputView, regionToScreen, videoPointerDelta } from "../../utils/video-utils";
import { getContentPx } from "../../utils/region-interaction";
import { REGION_EDIT_MODES } from "./utils";
import { scaleTextStyleToRegion } from "../../utils/text-style";
import {
  itemOutputGeometry,
  outputRegionOnSource,
  sourceRegionToOutput,
} from "../../utils/stamp-geometry";

function dragDelta(video, start, e) {
  if (isInOutputView(video)) {
    const delta = videoPointerDelta(video, { clientX: start.mouseX, clientY: start.mouseY }, e);
    if (delta) return delta;
  }
  return {
    dx: (e.clientX - start.mouseX) / (start.contentW || 1),
    dy: (e.clientY - start.mouseY) / (start.contentH || 1),
  };
}

function stampGeometryOf(op) {
  if (op?.mode !== "datetime") return null;
  const st = useEditorStore.getState();
  const item = st.queue[st.selectedIdx];
  return item ? itemOutputGeometry(item) : null;
}

export default function useOperationDrag({
  videoRef,
  sel,
  sidebarMode,
  activeTool,
  currentRegion,
  selectedOperationIdx,
  showFfmpegPreview,
  showFfmpegOverlay,
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
    const st = useEditorStore.getState();
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
      stampGeometry: stampGeometryOf(op),
    });
  };

  const handleImageDragMove = useCallback(
    (e) => {
      if (!draggingOp || !dragStart) return;
      const { dx: normalizedDeltaX, dy: normalizedDeltaY } = dragDelta(
        videoRef.current,
        dragStart,
        e,
      );
      const geo = dragStart.stampGeometry;
      if (geo) {
        const start = { ...draggingOp.op.region, x: dragStart.regionX, y: dragStart.regionY };
        const { rect } = outputRegionOnSource(start, geo);
        const moved = sourceRegionToOutput(
          { ...rect, x: rect.x + normalizedDeltaX, y: rect.y + normalizedDeltaY },
          geo,
        );
        const { w, h } = draggingOp.op.region;
        updateOperationRegion(
          draggingOp.opIdx,
          {
            ...draggingOp.op.region,
            x: Math.max(0, Math.min(1 - w, moved.x)),
            y: Math.max(0, Math.min(1 - h, moved.y)),
          },
          { recordHistory: false },
        );
        return;
      }

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
    [draggingOp, dragStart, updateOperationRegion, videoRef],
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
    const geo = op.mode === "datetime" && sel ? itemOutputGeometry(sel) : null;
    const region = geo ? outputRegionOnSource(op.region, geo).rect : op.region;
    return { op, opIdx: selectedOperationIdx, region };
  }, [
    sel,
    selectedOperationIdx,
    currentRegion,
    showFfmpegPreview,
    showFfmpegOverlay,
    sidebarMode,
    activeTool,
  ]);

  const resizeStart = useRef(null);
  const patchSelectedRegionOp = useCallback((region) => {
    const st = useEditorStore.getState();
    const idx = st.selectedOperationIdx;
    if (idx == null) return;
    const geo = stampGeometryOf(st.queue[st.selectedIdx]?.operations?.[idx]);
    if (geo) region = sourceRegionToOutput(region, geo);
    const start = resizeStart.current;
    if (!start) {
      st.updateOperationRegion(idx, region, { recordHistory: false });
      return;
    }
    st.updateOperation(
      st.selectedIdx,
      idx,
      { region: { ...region }, ...scaleTextStyleToRegion(start, start.region, region) },
      { recordHistory: false },
    );
  }, []);

  const selectedRegionOpGesture = useRegionGesture({
    videoEl: videoRef,
    enabled: !!selectedRegionOp,
    onChange: patchSelectedRegionOp,
    onCommit: patchSelectedRegionOp,
  });

  const keyboardSnapshot = useRef(null);
  const selectedRegionOpGestureWrapped = useMemo(
    () => ({
      ...selectedRegionOpGesture,
      beginMove: (e, region) => {
        useEditorStore.getState()._saveUndo?.();
        resizeStart.current = null;
        selectedRegionOpGesture.beginMove(e, region);
      },
      beginResize: (e, region, handle) => {
        const st = useEditorStore.getState();
        st._saveUndo?.();
        const op = st.queue[st.selectedIdx]?.operations?.[st.selectedOperationIdx];
        resizeStart.current = op?.mode === "datetime" ? { ...op, region: { ...op.region } } : null;
        selectedRegionOpGesture.beginResize(e, region, handle);
      },
      nudge: (region, dxPx, dyPx) => {
        const st = useEditorStore.getState();
        const opId = st.queue[st.selectedIdx]?.operations?.[st.selectedOperationIdx]?.id;
        const owner = `${st.selectedIdx}:${opId}`;
        const snap = keyboardSnapshot.current;
        if (snap?.stack !== st.undoStack || snap.owner !== owner) {
          st._saveUndo?.();
          keyboardSnapshot.current = { stack: useEditorStore.getState().undoStack, owner };
        }
        resizeStart.current = null;
        selectedRegionOpGesture.nudge(region, dxPx, dyPx);
      },
      endNudge: () => {
        keyboardSnapshot.current = null;
      },
    }),
    [selectedRegionOpGesture],
  );

  const selectedRegionOpScreen = selectedRegionOp
    ? regionToScreen(selectedRegionOp.region, videoRef.current)
    : null;

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
      const startRegion = batchTextDragStart.region;
      const { dx: deltaX, dy: deltaY } = dragDelta(videoRef.current, batchTextDragStart, e);
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
    [draggingBatchText, batchTextDragStart, videoRef],
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
