import { useState, useCallback } from "react";
import useEditorStore from "../../stores/useEditorStore";
import { getContentPx } from "../../utils/region-interaction";
import { findTextOpForRegion } from "../../utils/text-style";

/** Free-drag of batch template text regions on the video preview. */
export default function useBatchTextDrag(videoRef) {
  const [draggingBatchText, setDraggingBatchText] = useState(null);
  const [batchTextDragStart, setBatchTextDragStart] = useState(null);

  const handleBatchTextDragStart = useCallback(
    (tr, e) => {
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
    },
    [videoRef],
  );

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

  return {
    draggingBatchText,
    handleBatchTextDragStart,
    handleBatchTextDragMove,
    handleBatchTextDragEnd,
  };
}
