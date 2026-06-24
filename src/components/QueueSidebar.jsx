import { useState, useEffect, useRef, memo, useCallback, useMemo } from "react";
import {
  Plus,
  Trash2,
  FileVideo,
  Edit3,
  MoreVertical,
  Play,
  RotateCw,
  FolderOpen,
  Eye,
  Copy,
} from "lucide-react";
import useEditorStore from "../stores/useEditorStore";
import { fmtTime } from "../utils/video-utils";
import MatchBadge from "./MatchBadge";
import { useT } from "../i18n/useT";

const api = window.api;

const STATUS_COLORS = {
  idle: "var(--text-dim)",
  queued: "#fbbf24",
  processing: "#00f0ea",
  done: "#22c55e",
  error: "#f43f5e",
};

const Thumbnail = memo(function Thumbnail({ value }) {
  if (value) {
    return (
      <div
        className="w-[44px] h-[25px] rounded-sm overflow-hidden flex-shrink-0"
        style={{ background: "#000" }}
      >
        <img src={value} alt="" className="w-full h-full object-cover" draggable={false} />
      </div>
    );
  }
  return (
    <div
      className="w-[44px] h-[25px] rounded-sm flex items-center justify-center flex-shrink-0"
      style={{ background: "var(--bg-app)", color: "var(--text-dim)" }}
    >
      <FileVideo size={12} />
    </div>
  );
});

/**
 * Derived per-row data: counts of text vs non-text operations, plus the match
 * status. Computed once per queue change and passed as stable primitives to the
 * memoized row so an op edit on one row doesn't recompute badges for the others.
 */
function deriveRow(item, idx, excelPath, excelMatchStatus) {
  let textOps = 0;
  let otherOps = 0;
  const ops = item.operations;
  if (ops?.length > 0) {
    for (let i = 0; i < ops.length; i++) {
      if (ops[i].mode === "text") textOps++;
      else otherOps++;
    }
  }
  const matchStatus = excelPath ? excelMatchStatus[idx] || "unmatched" : "none";
  return { textOps, otherOps, matchStatus };
}

const QueueRow = memo(
  function QueueRow({
    item,
    idx,
    isSelected,
    isTemplate,
    textOps,
    otherOps,
    matchStatus,
    showMatch,
    isOpen,
    isProcessing,
    hasOutputDir,
    t,
    menuRef,
    onSelect,
    onToggleMenu,
    onProcessThis,
    onReveal,
    onOpenOutputDir,
    onCopyName,
    onRemove,
  }) {
    return (
      <div
        onClick={() => onSelect(idx)}
        className="flex items-center gap-2 px-3 py-2 border-b cursor-pointer transition-colors group relative"
        style={{
          borderColor: "var(--border)",
          background: isSelected ? "var(--bg-elevated)" : "transparent",
        }}
      >
        <Thumbnail value={item.thumbnail} />
        <div
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ background: STATUS_COLORS[item.status] }}
        />
        {showMatch && <MatchBadge status={matchStatus} size={9} />}
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium truncate" style={{ color: "var(--text-primary)" }}>
            {item.filename}
          </div>
          <div className="text-[10px] flex gap-2" style={{ color: "var(--text-dim)" }}>
            {item.width > 0 && (
              <span>
                {item.width}×{item.height}
              </span>
            )}
            {item.duration > 0 && <span>{fmtTime(item.duration)}</span>}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {(textOps > 0 || otherOps > 0) && (
            <>
              {textOps > 0 && (
                <span
                  className="text-[9px] px-1 py-0.5 rounded font-mono"
                  style={{ background: "#a855f722", color: "#a855f7" }}
                  title="Texto del batch"
                >
                  T{textOps}
                </span>
              )}
              {otherOps > 0 && (
                <span
                  className="text-[10px] w-5 h-5 rounded-full flex items-center justify-center font-mono"
                  style={{ background: "var(--bg-app)", color: "var(--accent)" }}
                >
                  {otherOps}
                </span>
              )}
            </>
          )}
          {isTemplate && (
            <Edit3 size={12} style={{ color: "#a855f7" }} title={t("queue.templateBadge")} />
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleMenu(idx);
            }}
            className="opacity-0 group-hover:opacity-100"
            style={{ color: "var(--text-dim)" }}
            title={t("queue.contextMenu")}
          >
            <MoreVertical size={12} />
          </button>
        </div>

        {isOpen && (
          <div
            ref={menuRef}
            className="absolute right-2 top-full mt-1 z-30 rounded-md shadow-xl py-1 w-[200px]"
            style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => onProcessThis(idx)}
              disabled={isProcessing}
              className="w-full text-left px-3 py-1.5 text-[11px] flex items-center gap-2 hover:opacity-80 disabled:opacity-40"
              style={{ color: "var(--text-primary)" }}
            >
              <Play size={11} /> {t("queue.menu.processThis")}
            </button>
            {item.status === "error" && (
              <button
                onClick={() => onProcessThis(idx)}
                disabled={isProcessing}
                className="w-full text-left px-3 py-1.5 text-[11px] flex items-center gap-2 hover:opacity-80 disabled:opacity-40"
                style={{ color: "var(--accent)" }}
              >
                <RotateCw size={11} /> {t("queue.menu.retry")}
              </button>
            )}
            <div className="my-1 border-t" style={{ borderColor: "var(--border)" }} />
            <button
              onClick={onOpenOutputDir}
              disabled={!hasOutputDir}
              className="w-full text-left px-3 py-1.5 text-[11px] flex items-center gap-2 hover:opacity-80 disabled:opacity-40"
              style={{ color: "var(--text-primary)" }}
            >
              <FolderOpen size={11} /> {t("queue.menu.openFolder")}
            </button>
            <button
              onClick={() => onReveal(idx)}
              disabled={!hasOutputDir}
              className="w-full text-left px-3 py-1.5 text-[11px] flex items-center gap-2 hover:opacity-80 disabled:opacity-40"
              style={{ color: "var(--text-primary)" }}
            >
              <Eye size={11} /> {t("queue.menu.showInExplorer")}
            </button>
            <button
              onClick={() => onCopyName(idx)}
              className="w-full text-left px-3 py-1.5 text-[11px] flex items-center gap-2 hover:opacity-80"
              style={{ color: "var(--text-primary)" }}
            >
              <Copy size={11} /> {t("queue.menu.copyName")}
            </button>
            <div className="my-1 border-t" style={{ borderColor: "var(--border)" }} />
            <button
              onClick={() => onRemove(idx)}
              disabled={isProcessing}
              className="w-full text-left px-3 py-1.5 text-[11px] flex items-center gap-2 hover:opacity-80 disabled:opacity-40"
              style={{ color: "#f43f5e" }}
            >
              <Trash2 size={11} /> {t("queue.menu.removeVideo")}
            </button>
          </div>
        )}
      </div>
    );
  },
  (prev, next) => {
    // Re-render only when a value the row actually reads changed. `item` is a
    // store queue element compared by reference — the store only creates a new
    // item object when that specific item mutates, so rows whose item didn't
    // change are skipped entirely.
    return (
      prev.item === next.item &&
      prev.idx === next.idx &&
      prev.isSelected === next.isSelected &&
      prev.isTemplate === next.isTemplate &&
      prev.textOps === next.textOps &&
      prev.otherOps === next.otherOps &&
      prev.matchStatus === next.matchStatus &&
      prev.showMatch === next.showMatch &&
      prev.isOpen === next.isOpen &&
      prev.isProcessing === next.isProcessing &&
      prev.hasOutputDir === next.hasOutputDir &&
      prev.t === next.t &&
      prev.menuRef === next.menuRef &&
      prev.onSelect === next.onSelect &&
      prev.onToggleMenu === next.onToggleMenu &&
      prev.onProcessThis === next.onProcessThis &&
      prev.onReveal === next.onReveal &&
      prev.onOpenOutputDir === next.onOpenOutputDir &&
      prev.onCopyName === next.onCopyName &&
      prev.onRemove === next.onRemove
    );
  },
);

export default function QueueSidebar() {
  const queue = useEditorStore((s) => s.queue);
  const selectedIdx = useEditorStore((s) => s.selectedIdx);
  const templateIdx = useEditorStore((s) => s.templateIdx);
  const excelMatchStatus = useEditorStore((s) => s.excelMatchStatus);
  const excelPath = useEditorStore((s) => s.excelPath);
  const isProcessing = useEditorStore((s) => s.isProcessing);
  const outputDir = useEditorStore((s) => s.outputDir);
  const showToast = useEditorStore((s) => s.showToast);
  const get = useEditorStore.getState;
  const t = useT();
  const [openMenuIdx, setOpenMenuIdx] = useState(-1);
  const menuRef = useRef(null);

  useEffect(() => {
    if (openMenuIdx < 0) return;
    const onDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpenMenuIdx(-1);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpenMenuIdx(-1);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [openMenuIdx]);

  const handleClear = useCallback(() => {
    if (isProcessing) {
      showToast({ kind: "warn", text: t("queue.processingBusy") });
      return;
    }
    get().clearQueue();
  }, [isProcessing, showToast, t, get]);

  const handleAdd = useCallback(async () => {
    if (!api?.openVideos) {
      showToast({ kind: "err", text: t("errors.noApi") });
      return;
    }
    try {
      const paths = await api.openVideos();
      if (!paths?.length) return;
      await get().addVideos(paths, api);
      showToast({ kind: "ok", text: t("drop.added", { count: paths.length }) });
    } catch (err) {
      console.error("[beru] Video import failed:", err);
      showToast({
        kind: "err",
        text: t("errors.importVideosFailed", {
          message: err?.message || t("errors.unknown"),
        }),
      });
    }
  }, [showToast, t, get]);

  const handleProcessThis = useCallback(
    async (idx) => {
      setOpenMenuIdx(-1);
      if (isProcessing) {
        showToast({ kind: "warn", text: t("queue.processingBusy") });
        return;
      }
      const res = await get().processSingle(idx);
      if (res.ok) {
        showToast({ kind: "ok", text: t("queue.renderComplete") });
      } else {
        showToast({
          kind: "err",
          text: res.error || t("queue.processFailed"),
        });
      }
    },
    [isProcessing, showToast, t, get],
  );

  const handleReveal = useCallback(
    (idx) => {
      setOpenMenuIdx(-1);
      const out = get().outputPathFor(get().queue[idx]);
      if (out) api?.showItemInFolder(out);
    },
    [get],
  );

  const handleOpenOutputDir = useCallback(() => {
    setOpenMenuIdx(-1);
    const dir = get().outputDir;
    if (dir) api?.openPath(dir);
  }, [get]);

  const handleCopyName = useCallback(
    async (idx) => {
      setOpenMenuIdx(-1);
      const name = get().queue[idx]?.filename || "";
      try {
        await navigator.clipboard.writeText(name);
        showToast({ kind: "ok", text: t("queue.copiedName") });
      } catch {
        showToast({ kind: "err", text: t("queue.copyFailed") });
      }
    },
    [showToast, t, get],
  );

  const handleRemove = useCallback(
    (idx) => {
      setOpenMenuIdx(-1);
      get().removeVideo(idx);
    },
    [get],
  );

  const handleSelect = useCallback((idx) => get().selectVideo(idx), [get]);
  const handleToggleMenu = useCallback(
    (idx) => setOpenMenuIdx((prev) => (prev === idx ? -1 : idx)),
    [],
  );
  // Only the row with the open menu receives the shared menuRef; the comparator
  // above treats menuRef as identity, so a stable ref object keeps the open row
  // from re-rendering when unrelated rows update.
  const setMenuRef = useCallback((el) => {
    menuRef.current = el;
  }, []);

  // Precompute per-row derived data (op counts, match status) once per queue /
  // excel state change. Only rows whose input changed get new objects, so the
  // memoized QueueRow comparator can skip unchanged rows.
  const rows = useMemo(() => {
    const out = new Array(queue.length);
    for (let i = 0; i < queue.length; i++) {
      out[i] = deriveRow(queue[i], i, excelPath, excelMatchStatus);
    }
    return out;
  }, [queue, excelPath, excelMatchStatus]);

  const hasOutputDir = Boolean(outputDir);

  return (
    <aside
      className="w-[220px] flex-shrink-0 flex flex-col border-r relative"
      style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}
    >
      <div
        className="p-3 border-b flex items-center justify-between"
        style={{ borderColor: "var(--border)" }}
      >
        <span
          className="text-[10px] font-semibold tracking-wider uppercase"
          style={{ color: "var(--text-dim)" }}
        >
          {t("queue.title")} ({queue.length})
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={handleClear}
            disabled={queue.length === 0 || isProcessing}
            className="cap-btn-secondary !p-1 disabled:opacity-40"
            title={t("queue.clearQueue")}
          >
            <Trash2 size={14} />
          </button>
          <button
            onClick={handleAdd}
            className="cap-btn-secondary !p-1"
            title={t("queue.addVideos")}
          >
            <Plus size={14} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {queue.map((item, idx) => {
          const derived = rows[idx];
          return (
            <QueueRow
              key={item.path}
              item={item}
              idx={idx}
              isSelected={idx === selectedIdx}
              isTemplate={idx === templateIdx}
              textOps={derived.textOps}
              otherOps={derived.otherOps}
              matchStatus={derived.matchStatus}
              showMatch={Boolean(excelPath)}
              isOpen={openMenuIdx === idx}
              isProcessing={isProcessing}
              hasOutputDir={hasOutputDir}
              t={t}
              menuRef={openMenuIdx === idx ? setMenuRef : null}
              onSelect={handleSelect}
              onToggleMenu={handleToggleMenu}
              onProcessThis={handleProcessThis}
              onReveal={handleReveal}
              onOpenOutputDir={handleOpenOutputDir}
              onCopyName={handleCopyName}
              onRemove={handleRemove}
            />
          );
        })}
      </div>
    </aside>
  );
}
