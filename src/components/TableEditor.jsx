import { useState, useRef, useEffect, useCallback } from "react";
import { X, Layers } from "lucide-react";
import { shallow } from "zustand/shallow";
import useEditorStore from "../stores/useEditorStore";
import { findTextOpForRegion } from "../utils/text-style";
import TableEditorPreview from "./table-editor/TableEditorPreview";
import TableEditorFocusPanel from "./table-editor/TableEditorFocusPanel";
import TableEditorGrid from "./table-editor/TableEditorGrid";

function resolvedDuration(video, fallback) {
  const mediaDuration = Number(video?.duration);
  if (Number.isFinite(mediaDuration) && mediaDuration > 0) return mediaDuration;
  const fallbackDuration = Number(fallback);
  return Number.isFinite(fallbackDuration) && fallbackDuration > 0 ? fallbackDuration : 0;
}

export default function TableEditor() {
  const {
    showTableEditor,
    queue,
    templateRegions,
    excelPath,
    excelMapping,
    excelRows,
    excelMatchStatus,
  } = useEditorStore(
    (s) => ({
      showTableEditor: s.showTableEditor,
      queue: s.queue,
      templateRegions: s.templateRegions,
      excelPath: s.excelPath,
      excelMapping: s.excelMapping,
      excelRows: s.excelRows,
      excelMatchStatus: s.excelMatchStatus,
    }),
    shallow,
  );
  const get = useEditorStore.getState;
  const [focused, setFocused] = useState({ videoIdx: 0, regionId: null });
  const [editingCell, setEditingCell] = useState(null);
  const [editValue, setEditValue] = useState("");
  const videoRef = useRef(null);
  const tableRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [seeking, setSeeking] = useState(false);
  const seekingRef = useRef(false);
  const [, setLayoutTick] = useState(0);
  const focusedVideoDuration = queue[focused.videoIdx]?.duration;
  const firstRegionId = templateRegions[0]?.id ?? null;

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !showTableEditor) return;
    const ro = new ResizeObserver(() => setLayoutTick((t) => t + 1));
    ro.observe(v);
    return () => ro.disconnect();
  }, [showTableEditor, focused.videoIdx]);

  useEffect(() => {
    if (showTableEditor) {
      setFocused({ videoIdx: 0, regionId: firstRegionId });
      setEditingCell(null);
      setPlaying(false);
      tableRef.current?.focus();
    }
    // Only reset focus when the editor opens, not when templateRegions.length
    // changes while open (which would silently yank the user's focused cell).
  }, [showTableEditor, firstRegionId]);

  // Mirror `seeking` into a ref so the video listener effect below does not
  // depend on `seeking` — otherwise every scrub toggle tears down and re-adds
  // all five listeners, dropping any timeupdate/play/pause in the gap.
  useEffect(() => {
    seekingRef.current = seeking;
  }, [seeking]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTimeUpdate = () => {
      if (!seekingRef.current) setCurrentTime(v.currentTime);
    };
    const onLoadedMeta = () => setDuration(resolvedDuration(v, focusedVideoDuration));
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
  }, [focused.videoIdx, focusedVideoDuration]);

  useEffect(() => {
    setPlaying(false);
    setCurrentTime(0);
    setDuration(queue[focused.videoIdx]?.duration || 0);
  }, [focused.videoIdx]);

  const seekTo = useCallback(
    (fraction) => {
      const v = videoRef.current;
      const d = resolvedDuration(v, duration || focusedVideoDuration);
      if (v && d > 0) v.currentTime = Math.max(0, Math.min(d, fraction * d));
    },
    [duration, focusedVideoDuration],
  );

  const startInlineEdit = useCallback((videoIdx, regionId, currentText) => {
    setEditingCell({ videoIdx, regionId });
    setEditValue(currentText || "");
  }, []);

  const commitInlineEdit = useCallback(() => {
    if (!editingCell) return;
    const { videoIdx, regionId } = editingCell;
    const video = queue[videoIdx];
    const region = templateRegions.find((r) => r.id === regionId);
    if (!video || !region) {
      setEditingCell(null);
      return;
    }
    const { op, opIdx } = findTextOpForRegion(video.operations, region.region, regionId);
    if (op) {
      get().updateOperationText(videoIdx, opIdx, editValue);
    } else if (editValue.length > 0) {
      const newIdx = get().createTextOpForRegion(videoIdx, regionId);
      if (newIdx >= 0) get().updateOperationText(videoIdx, newIdx, editValue);
    } else {
      get().syncTextToExcel(videoIdx, regionId, "");
    }
    setEditingCell(null);
  }, [editingCell, editValue, get, queue, templateRegions]);

  const cancelInlineEdit = useCallback(() => setEditingCell(null), []);

  const moveFocus = useCallback(
    (deltaRow, deltaCol) => {
      if (queue.length === 0 || templateRegions.length === 0) return;
      setFocused((f) => {
        const vCount = queue.length;
        const cCount = templateRegions.length;
        const curCol =
          f.regionId == null
            ? 0
            : Math.max(
                0,
                templateRegions.findIndex((r) => r.id === f.regionId),
              );
        const newCol = Math.max(0, Math.min(cCount - 1, curCol + deltaCol));
        const newRow = Math.max(0, Math.min(vCount - 1, f.videoIdx + deltaRow));
        return { videoIdx: newRow, regionId: templateRegions[newCol]?.id ?? null };
      });
    },
    [queue.length, templateRegions],
  );

  const handleTableKey = useCallback(
    (e) => {
      if (editingCell) {
        if (e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          commitInlineEdit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          cancelInlineEdit();
        }
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        moveFocus(1, 0);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        moveFocus(-1, 0);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        e.stopPropagation();
        moveFocus(0, 1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        e.stopPropagation();
        moveFocus(0, -1);
      } else if (e.key === "Enter" || e.key === "F2") {
        e.preventDefault();
        e.stopPropagation();
        const region = templateRegions.find((r) => r.id === focused.regionId);
        const video = queue[focused.videoIdx];
        if (!region || !video) return;
        startInlineEdit(
          focused.videoIdx,
          focused.regionId,
          get().getCellTextForRegion(focused.videoIdx, focused.regionId),
        );
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        e.stopPropagation();
        const region = templateRegions.find((r) => r.id === focused.regionId);
        const video = queue[focused.videoIdx];
        if (!region || !video) return;
        const { opIdx } = findTextOpForRegion(video.operations, region.region, focused.regionId);
        if (opIdx >= 0) get().removeOperationAt(focused.videoIdx, opIdx);
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        get().setShowTableEditor(false);
      }
    },
    [
      editingCell,
      focused,
      templateRegions,
      queue,
      commitInlineEdit,
      cancelInlineEdit,
      moveFocus,
      startInlineEdit,
      get,
    ],
  );

  if (!showTableEditor || queue.length === 0) return null;

  const focusedVideo = queue[focused.videoIdx];
  const focusedRegion = templateRegions.find((r) => r.id === focused.regionId);
  const { op: focusedOp, opIdx: focusedOpIdx } = findTextOpForRegion(
    focusedVideo?.operations || [],
    focusedRegion?.region,
    focusedRegion?.id,
  );

  const updateFocused = (patch) => {
    if (focusedOpIdx < 0) return;
    get().updateOperation(focused.videoIdx, focusedOpIdx, patch);
  };

  const createFocusedOp = () => {
    if (!focusedRegion) return;
    const newIdx = get().createTextOpForRegion(focused.videoIdx, focused.regionId);
    if (newIdx >= 0 && editValue) {
      get().updateOperationText(focused.videoIdx, newIdx, editValue);
    }
  };

  const deleteFocusedOp = () => {
    if (focusedOpIdx < 0) return;
    get().removeOperationAt(focused.videoIdx, focusedOpIdx);
  };

  const hasRegions = templateRegions.length > 0;
  const getBatchPreviewPayload = (videoIdx, regionId) =>
    get().getBatchPreviewPayload(videoIdx, regionId);

  return (
    <div className="cap-modal-overlay" onClick={() => get().setShowTableEditor(false)}>
      <div
        className="cap-modal-panel w-[95vw] max-w-[1200px] max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0"
          style={{ borderColor: "var(--border)" }}
        >
          <div className="flex items-center gap-2">
            <Layers size={16} style={{ color: "var(--purple)" }} />
            <span className="text-sm font-semibold">Editor de tabla</span>
            <span className="text-[10px]" style={{ color: "var(--text-dim)" }}>
              {queue.length} videos · {templateRegions.length} regiones
              {excelPath && excelRows.length > 0 && (
                <>
                  {" "}
                  · Excel ({excelRows.length} filas
                  {excelMapping.idColumn ? `, ID: ${excelMapping.idColumn}` : ""})
                </>
              )}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[10px]" style={{ color: "var(--text-dim)" }}>
              ↑↓←→ navegar · Enter editar · Del eliminar · Esc cerrar
            </span>
            <button
              onClick={() => get().setShowTableEditor(false)}
              className="p-1 rounded hover:bg-white/10"
              style={{ color: "var(--text-dim)" }}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Top section: Preview + Editing row */}
        <div className="flex flex-1 min-h-0 border-b" style={{ borderColor: "var(--border)" }}>
          <TableEditorPreview
            videoRef={videoRef}
            focusedVideo={focusedVideo}
            focused={focused}
            templateRegions={templateRegions}
            focusedOp={focusedOp}
            playing={playing}
            currentTime={currentTime}
            duration={duration}
            seeking={seeking}
            setSeeking={setSeeking}
            seekTo={seekTo}
            setCurrentTime={setCurrentTime}
            getBatchPreviewPayload={getBatchPreviewPayload}
          />

          <TableEditorFocusPanel
            hasRegions={hasRegions}
            focusedRegion={focusedRegion}
            focusedVideo={focusedVideo}
            focused={focused}
            queueLength={queue.length}
            focusedOp={focusedOp}
            updateFocused={updateFocused}
            createFocusedOp={createFocusedOp}
            deleteFocusedOp={deleteFocusedOp}
          />
        </div>

        <TableEditorGrid
          tableRef={tableRef}
          hasRegions={hasRegions}
          queue={queue}
          templateRegions={templateRegions}
          excelPath={excelPath}
          excelMapping={excelMapping}
          excelMatchStatus={excelMatchStatus}
          focused={focused}
          setFocused={setFocused}
          editingCell={editingCell}
          editValue={editValue}
          setEditValue={setEditValue}
          startInlineEdit={startInlineEdit}
          commitInlineEdit={commitInlineEdit}
          cancelInlineEdit={cancelInlineEdit}
          handleTableKey={handleTableKey}
        />
      </div>
    </div>
  );
}
