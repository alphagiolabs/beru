import { useState, useEffect, useRef, memo, useCallback } from "react";
import {
  Plus,
  Trash2,
  FileVideo,
  Edit3,
  MoreHorizontal,
  Play,
  RotateCw,
  FolderOpen,
  Eye,
  Copy,
} from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import useEditorStore from "../stores/useEditorStore";
import { fmtTime } from "../utils/video-utils";
import MatchBadge from "./MatchBadge";
import { useT } from "../i18n/useT";
import { PERF_FLAGS } from "../utils/perf-flags.js";
import { importVideosFromDialog } from "../utils/import-videos";
import { Button } from "./ui/Button";

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
        className="w-[44px] h-[25px] rounded-[5px] overflow-hidden flex-shrink-0"
        style={{ background: "#000" }}
      >
        <img src={value} alt="" className="w-full h-full object-cover" draggable={false} />
      </div>
    );
  }
  return (
    <div
      className="w-[44px] h-[25px] rounded-[5px] flex items-center justify-center flex-shrink-0"
      style={{ background: "var(--bg-app)", color: "var(--text-dim)" }}
    >
      <FileVideo size={12} />
    </div>
  );
});

const opCountsCache = new WeakMap();

function deriveRow(item, idx, excelPath, excelMatchStatus) {
  let counts = opCountsCache.get(item);
  if (!counts) {
    let textOps = 0;
    let otherOps = 0;
    const ops = item.operations;
    if (ops?.length > 0) {
      for (let i = 0; i < ops.length; i++) {
        if (ops[i].mode === "text") textOps++;
        else otherOps++;
      }
    }
    counts = { textOps, otherOps };
    opCountsCache.set(item, counts);
  }
  const matchStatus = excelPath ? excelMatchStatus[idx] || "unmatched" : "none";
  return { ...counts, matchStatus };
}

const QueueRow = memo(
  function QueueRow({
    item,
    idx,
    thumbnail,
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
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect(idx);
          }
        }}
        role="button"
        tabIndex={0}
        aria-pressed={isSelected}
        data-index={idx}
        className={`queue-row group${isSelected ? " is-selected" : ""}`}
      >
        <div className="relative flex-shrink-0">
          <Thumbnail value={thumbnail} />
          {item.status !== "idle" && (
            <span className="queue-row-status" style={{ background: STATUS_COLORS[item.status] }} />
          )}
        </div>
        {showMatch && <MatchBadge status={matchStatus} size={9} />}
        <div className="flex-1 min-w-0">
          <div className="queue-row-name truncate">{item.filename}</div>
          <div className="queue-row-meta">
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
                  style={{ background: "var(--bg-elevated)", color: "var(--text-purple)" }}
                  title={t("queue.batchTextOps")}
                >
                  T{textOps}
                </span>
              )}
              {otherOps > 0 && (
                <span
                  className="text-[10px] w-5 h-5 rounded-full flex items-center justify-center font-mono"
                  style={{ background: "var(--bg-app)", color: "var(--text-accent)" }}
                >
                  {otherOps}
                </span>
              )}
            </>
          )}
          {isTemplate && (
            <Edit3
              size={12}
              style={{ color: "var(--text-purple)" }}
              title={t("queue.templateBadge")}
            />
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleMenu(idx);
            }}
            className="queue-row-menu opacity-0 group-hover:opacity-100"
            style={{ color: "var(--text-dim)" }}
            title={t("queue.contextMenu")}
          >
            <MoreHorizontal size={14} />
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
              type="button"
              onClick={() => onProcessThis(idx)}
              disabled={isProcessing}
              className="w-full text-left px-3 py-1.5 text-[11px] flex items-center gap-2 hover:opacity-80 disabled:opacity-40"
              style={{ color: "var(--text-primary)" }}
            >
              <Play size={11} /> {t("queue.menu.processThis")}
            </button>
            {item.status === "error" && (
              <button
                type="button"
                onClick={() => onProcessThis(idx)}
                disabled={isProcessing}
                className="w-full text-left px-3 py-1.5 text-[11px] flex items-center gap-2 hover:opacity-80 disabled:opacity-40"
                style={{ color: "var(--text-accent)" }}
              >
                <RotateCw size={11} /> {t("queue.menu.retry")}
              </button>
            )}
            <div className="my-1 border-t" style={{ borderColor: "var(--border)" }} />
            <button
              type="button"
              onClick={onOpenOutputDir}
              disabled={!hasOutputDir}
              className="w-full text-left px-3 py-1.5 text-[11px] flex items-center gap-2 hover:opacity-80 disabled:opacity-40"
              style={{ color: "var(--text-primary)" }}
            >
              <FolderOpen size={11} /> {t("queue.menu.openFolder")}
            </button>
            <button
              type="button"
              onClick={() => onReveal(idx)}
              disabled={!hasOutputDir}
              className="w-full text-left px-3 py-1.5 text-[11px] flex items-center gap-2 hover:opacity-80 disabled:opacity-40"
              style={{ color: "var(--text-primary)" }}
            >
              <Eye size={11} /> {t("queue.menu.showInExplorer")}
            </button>
            <button
              type="button"
              onClick={() => onCopyName(idx)}
              className="w-full text-left px-3 py-1.5 text-[11px] flex items-center gap-2 hover:opacity-80"
              style={{ color: "var(--text-primary)" }}
            >
              <Copy size={11} /> {t("queue.menu.copyName")}
            </button>
            <div className="my-1 border-t" style={{ borderColor: "var(--border)" }} />
            <button
              type="button"
              onClick={() => onRemove(idx)}
              disabled={isProcessing}
              className="w-full text-left px-3 py-1.5 text-[11px] flex items-center gap-2 hover:opacity-80 disabled:opacity-40"
              style={{ color: "var(--text-rose)" }}
            >
              <Trash2 size={11} /> {t("queue.menu.removeVideo")}
            </button>
          </div>
        )}
      </div>
    );
  },
  (prev, next) => {
    return (
      prev.item === next.item &&
      prev.idx === next.idx &&
      prev.thumbnail === next.thumbnail &&
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
  const thumbnailsByPath = useEditorStore((s) => s.thumbnailsByPath);
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
  const listParentRef = useRef(null);

  const useVirtual = PERF_FLAGS.virtualize && queue.length >= PERF_FLAGS.virtualizeThreshold;
  const rowVirtualizer = useVirtualizer({
    count: useVirtual ? queue.length : 0,
    getScrollElement: () => listParentRef.current,
    estimateSize: () => 49,
    overscan: 8,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();

  useEffect(() => {
    const root = listParentRef.current;
    if (!root || typeof IntersectionObserver !== "function") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const q = get().queue;
        const paths = entries
          .filter((entry) => entry.isIntersecting)
          .map((entry) => q[Number(entry.target.dataset.index)]?.path)
          .filter(Boolean);
        void get().prioritizeThumbnails(paths);
      },
      { root, rootMargin: "98px 0px" },
    );
    root.querySelectorAll(".queue-row").forEach((row) => observer.observe(row));
    return () => observer.disconnect();
  }, [queue.length, virtualRows, get]);

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
    await importVideosFromDialog({ api, store: get(), t, busy: isProcessing });
  }, [isProcessing, t, get]);

  const handleProcessThis = useCallback(
    async (idx) => {
      setOpenMenuIdx(-1);
      if (isProcessing) {
        showToast({ kind: "warn", text: t("queue.processingBusy") });
        return;
      }
      const res = await get().processSingle(idx);
      if (res.cancelled || res.superseded || res.notified) return;
      if (res.code === "already_processing") {
        showToast({ kind: "warn", text: t("queue.processingBusy") });
      } else if (res.ok) {
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
      if (!out) return;
      void api?.showItemInFolder(out).then((res) => {
        if (res && res.success === false) {
          showToast({ kind: "err", text: res.error || t("queue.revealFailed") });
        }
      });
    },
    [get, showToast, t],
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
  const setMenuRef = useCallback((el) => {
    menuRef.current = el;
  }, []);

  const hasOutputDir = Boolean(outputDir);

  return (
    <aside
      className="queue-sidebar w-[220px] flex-shrink-0 flex flex-col border-r relative"
      aria-labelledby="queue-title"
      style={{
        background: "var(--bg-surface)",
        borderColor: "color-mix(in srgb, var(--border) 65%, transparent)",
      }}
    >
      <div className="queue-header">
        <h2 id="queue-title" className="queue-title">
          {t("queue.title")}
          <span className="queue-count">{queue.length}</span>
        </h2>
        <div className="flex items-center gap-0.5">
          <Button
            type="button"
            onClick={handleClear}
            disabled={queue.length === 0 || isProcessing}
            variant="tertiary"
            size="icon"
            className="queue-header-btn"
            title={t("queue.clearQueue")}
          >
            <Trash2 size={14} strokeWidth={1.5} />
          </Button>
          <Button
            type="button"
            onClick={handleAdd}
            disabled={isProcessing}
            variant="tertiary"
            size="icon"
            className="queue-header-btn"
            title={t("queue.addVideos")}
          >
            <Plus size={15} strokeWidth={1.5} />
          </Button>
        </div>
      </div>

      <div ref={listParentRef} className="queue-list flex flex-1 min-h-0 flex-col overflow-y-auto">
        {queue.length === 0 ? (
          <div className="queue-empty" role="status">
            <FileVideo size={18} aria-hidden="true" />
            <strong>{t("queue.emptyTitle")}</strong>
            <span>{t("queue.emptyHint")}</span>
          </div>
        ) : useVirtual ? (
          <div
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
            {virtualRows.map((vRow) => {
              const idx = vRow.index;
              const item = queue[idx];
              if (!item) return null;
              const derived = deriveRow(item, idx, excelPath, excelMatchStatus);
              return (
                <div
                  key={item.path}
                  data-index={idx}
                  ref={rowVirtualizer.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${vRow.start}px)`,
                  }}
                >
                  <QueueRow
                    item={item}
                    idx={idx}
                    thumbnail={thumbnailsByPath?.[item.path] || null}
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
                </div>
              );
            })}
          </div>
        ) : (
          queue.map((item, idx) => {
            const derived = deriveRow(item, idx, excelPath, excelMatchStatus);
            return (
              <QueueRow
                key={item.path}
                item={item}
                idx={idx}
                thumbnail={thumbnailsByPath?.[item.path] || null}
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
          })
        )}
      </div>
    </aside>
  );
}
