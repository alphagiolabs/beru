import { useCallback, useMemo, useRef } from "react";
import useEditorStore from "../../stores/useEditorStore";
import useRegionGesture from "../../hooks/useRegionGesture";
import { regionToScreen } from "../../utils/video-utils";
import { REGION_EDIT_MODES } from "./utils";
import { scaleTextStyleToRegion } from "../../utils/text-style";
import {
  itemOutputGeometry,
  outputRegionOnSource,
  sourceRegionToOutput,
} from "../../utils/stamp-geometry";

function stampGeometryOf(op) {
  if (op?.mode !== "datetime") return null;
  const st = useEditorStore.getState();
  const item = st.queue[st.selectedIdx];
  return item ? itemOutputGeometry(item) : null;
}

export default function useOperationDrag({
  videoRef,
  sel,
  selectedIdx,
  sidebarMode,
  activeTool,
  currentRegion,
  selectedOperationIdx,
  showFfmpegPreview,
  showFfmpegOverlay,
}) {
  const dragOwner = useRef(null);
  const moveOperation = useCallback((region, dx, dy) => {
    const geo = dragOwner.current?.stampGeometry;
    let moved = { x: region.x + dx, y: region.y + dy };
    if (geo) {
      const { rect } = outputRegionOnSource(region, geo);
      moved = sourceRegionToOutput({ ...rect, x: rect.x + dx, y: rect.y + dy }, geo);
    }
    return {
      ...region,
      x: Math.max(0, Math.min(1 - region.w, moved.x)),
      y: Math.max(0, Math.min(1 - region.h, moved.y)),
    };
  }, []);
  const patchDraggedRegion = useCallback((region) => {
    const owner = dragOwner.current;
    if (!owner) return;
    const st = useEditorStore.getState();
    if (st.selectedIdx !== owner.videoIdx) return;
    const op = st.queue[owner.videoIdx]?.operations?.[owner.opIdx];
    if (
      !op ||
      op.id !== owner.op.id ||
      ["x", "y", "w", "h"].every((key) => op.region[key] === region[key])
    )
      return;
    st.updateOperation(owner.videoIdx, owner.opIdx, { region }, { recordHistory: !owner.recorded });
    owner.recorded = true;
    if (owner.regionId != null) st.setCurrentRegionDraft(region);
  }, []);
  const moveGesture = useRegionGesture({
    videoEl: videoRef,
    owner: `${selectedIdx}:${sel?.path}:${sidebarMode}:${activeTool}`,
    enabled: activeTool !== "pan",
    input: "mouse",
    pauseOnStart: false,
    moveRegion: moveOperation,
    onChange: patchDraggedRegion,
    onCommit: patchDraggedRegion,
  });

  const handleImageDragStart = (op, opIdx, e) => {
    const st = useEditorStore.getState();
    if (!moveGesture.beginMove(e, op.region)) return;
    dragOwner.current = { op, opIdx, videoIdx: st.selectedIdx, stampGeometry: stampGeometryOf(op) };
    if (st.selectedOperationIdx !== opIdx) st.selectOperation(opIdx);
  };

  const handleRegionOpDragStart = (opIdx, e) => {
    e.stopPropagation();
    if (showFfmpegPreview) return;
    const st = useEditorStore.getState();
    const op = st.queue[st.selectedIdx]?.operations?.[opIdx];
    if (!op?.region) return;
    handleImageDragStart(op, opIdx, e);
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
  const pendingHistory = useRef(false);
  const patchSelectedRegionOp = useCallback((region) => {
    const st = useEditorStore.getState();
    const idx = st.selectedOperationIdx;
    if (idx == null) return;
    const geo = stampGeometryOf(st.queue[st.selectedIdx]?.operations?.[idx]);
    if (geo) region = sourceRegionToOutput(region, geo);
    const op = st.queue[st.selectedIdx]?.operations?.[idx];
    if (!op || ["x", "y", "w", "h"].every((key) => op.region[key] === region[key])) return;
    const recordHistory = pendingHistory.current;
    pendingHistory.current = false;
    const start = resizeStart.current;
    if (!start) {
      st.updateOperationRegion(idx, region, { recordHistory });
      return;
    }
    st.updateOperation(
      st.selectedIdx,
      idx,
      { region: { ...region }, ...scaleTextStyleToRegion(start, start.region, region) },
      { recordHistory },
    );
  }, []);

  const selectedRegionOpGesture = useRegionGesture({
    videoEl: videoRef,
    owner: `${selectedIdx}:${sel?.path}:${selectedOperationIdx}:${selectedRegionOp?.op.id}`,
    enabled: !!selectedRegionOp,
    onChange: patchSelectedRegionOp,
    onCommit: patchSelectedRegionOp,
  });

  const keyboardSnapshot = useRef(null);
  const selectedRegionOpGestureWrapped = useMemo(
    () => ({
      ...selectedRegionOpGesture,
      beginMove: (e, region) => {
        pendingHistory.current = true;
        resizeStart.current = null;
        selectedRegionOpGesture.beginMove(e, region);
      },
      beginResize: (e, region, handle) => {
        const st = useEditorStore.getState();
        pendingHistory.current = true;
        const op = st.queue[st.selectedIdx]?.operations?.[st.selectedOperationIdx];
        resizeStart.current = op?.mode === "datetime" ? { ...op, region: { ...op.region } } : null;
        selectedRegionOpGesture.beginResize(e, region, handle);
      },
      nudge: (region, dxPx, dyPx) => {
        const st = useEditorStore.getState();
        const opId = st.queue[st.selectedIdx]?.operations?.[st.selectedOperationIdx]?.id;
        const owner = `${st.selectedIdx}:${opId}`;
        const snap = keyboardSnapshot.current;
        pendingHistory.current = snap?.stack !== st.undoStack || snap.owner !== owner;
        resizeStart.current = null;
        selectedRegionOpGesture.nudge(region, dxPx, dyPx);
        if (!pendingHistory.current)
          keyboardSnapshot.current = { stack: useEditorStore.getState().undoStack, owner };
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

    if (moveGesture.beginMove(e, op.region))
      dragOwner.current = { videoIdx, opIdx, op, regionId: tr.id };
  };

  return {
    draggingOp:
      moveGesture.active && dragOwner.current?.regionId == null ? dragOwner.current : null,
    draggingBatchText:
      moveGesture.active && dragOwner.current?.regionId != null ? dragOwner.current : null,
    handleImageDragStart,
    handleRegionOpDragStart,
    handleBatchTextDragStart,
    selectedRegionOp,
    selectedRegionOpScreen,
    selectedRegionOpGestureWrapped,
  };
}
