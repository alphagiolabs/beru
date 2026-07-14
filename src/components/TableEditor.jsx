import { useState, useRef, useEffect, useCallback } from "react";
import { X, FileSpreadsheet } from "lucide-react";
import { shallow } from "zustand/shallow";
import useEditorStore from "../stores/useEditorStore";
import { findTextOpForRegion } from "../utils/text-style";
import { useT } from "../i18n/useT";
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
  const t = useT();
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
  const showToast = useEditorStore((s) => s.showToast);
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
    const ro = new ResizeObserver(() => setLayoutTick((tick) => tick + 1));
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
  }, [showTableEditor, firstRegionId]);

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

  const handleExport = async () => {
    const res = await get().exportExcel();
    if (res?.canceled) return;
    if (res?.ok) {
      const name = (res.filePath || "").split(/[\\/]/).pop() || "export.xlsx";
      showToast({ kind: "ok", text: t("table.exportExcelOk", { name }) });
    } else {
      showToast({
        kind: "err",
        text: res?.error || t("table.exportExcelFailed"),
      });
    }
  };

  const metaParts = [
    `${queue.length} ${t("table.metaVideos")}`,
    `${templateRegions.length} ${t("table.metaRegions")}`,
  ];
  if (excelPath && excelRows.length > 0) {
    metaParts.push(
      `Excel ${excelRows.length}${excelMapping.idColumn ? ` · ${excelMapping.idColumn}` : ""}`,
    );
  }

  return (
    <div className="cap-modal-overlay" onClick={() => get().setShowTableEditor(false)}>
      <div
        className="table-editor"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t("table.title")}
      >
        <header className="te-header">
          <div className="te-header-left">
            <h2 className="te-header-title">{t("table.title")}</h2>
            <p className="te-header-meta">{metaParts.join(" · ")}</p>
          </div>
          <div className="te-header-right">
            <button
              type="button"
              className="te-ghost-btn"
              disabled={!excelRows?.length}
              title={t("table.exportExcel")}
              onClick={handleExport}
            >
              <FileSpreadsheet size={14} />
              <span>{t("table.exportExcel")}</span>
            </button>
            <button
              type="button"
              className="te-icon-btn"
              onClick={() => get().setShowTableEditor(false)}
              aria-label={t("table.close")}
              title={t("table.close")}
            >
              <X size={16} />
            </button>
          </div>
        </header>

        <div className="te-workspace">
          <div className="te-top">
            <TableEditorPreview
              videoRef={videoRef}
              focusedVideo={focusedVideo}
              focused={focused}
              templateRegions={templateRegions}
              focusedOp={focusedOp}
              playing={playing}
              currentTime={currentTime}
              duration={duration}
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
    </div>
  );
}
