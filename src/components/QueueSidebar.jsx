import { useState, useEffect, useRef } from "react";
import { Plus, Trash2, FileVideo, Edit3, MoreVertical, Play, RotateCw, FolderOpen, Eye, Copy, X } from "lucide-react";
import useEditorStore from "../stores/useEditorStore";
import { fmtTime, stripExt } from "../utils/video-utils";
import MatchBadge from "./MatchBadge";
import { useT } from "../i18n/useT";

const api = window.api;

function Thumbnail({ value, status }) {
  if (value) {
    return (
      <div className="w-[44px] h-[25px] rounded-sm overflow-hidden flex-shrink-0" style={{ background: "#000" }}>
        <img src={value} alt="" className="w-full h-full object-cover" draggable={false} />
      </div>
    );
  }
  return (
    <div className="w-[44px] h-[25px] rounded-sm flex items-center justify-center flex-shrink-0"
      style={{ background: "var(--bg-app)", color: "var(--text-dim)" }}>
      <FileVideo size={12} />
    </div>
  );
}

export default function QueueSidebar() {
  const store = useEditorStore();
  const { queue, selectedIdx, templateIdx, excelMatchStatus, excelPath, isProcessing } = store;
  const t = useT();
  const [openMenuIdx, setOpenMenuIdx] = useState(-1);
  const [toast, setToast] = useState(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (openMenuIdx < 0) return;
    const onDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpenMenuIdx(-1);
    };
    const onKey = (e) => { if (e.key === "Escape") setOpenMenuIdx(-1); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [openMenuIdx]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  const handleAdd = async () => {
    const paths = await api?.openVideos();
    if (paths && paths.length > 0) await store.addVideos(paths, api);
  };

  const statusColors = {
    idle: "var(--text-dim)",
    queued: "#fbbf24",
    processing: "#00f0ea",
    done: "#22c55e",
    error: "#f43f5e",
  };

  const handleProcessThis = async (idx) => {
    setOpenMenuIdx(-1);
    if (isProcessing) {
      setToast({ kind: "warn", text: "Hay un proceso en ejecución" });
      return;
    }
    const res = await store.processSingle(idx);
    if (res.ok) {
      setToast({ kind: "ok", text: "Render completo" });
    } else {
      setToast({ kind: "err", text: res.error || "Error al procesar" });
    }
  };

  const handleReveal = (idx) => {
    setOpenMenuIdx(-1);
    const out = store.outputPathFor(queue[idx]);
    if (out) api?.showItemInFolder(out);
  };

  const handleOpenOutputDir = () => {
    setOpenMenuIdx(-1);
    const dir = store.outputDir;
    if (dir) api?.openPath(dir);
  };

  const handleCopyName = async (idx) => {
    setOpenMenuIdx(-1);
    const name = queue[idx]?.filename || "";
    try {
      await navigator.clipboard.writeText(name);
      setToast({ kind: "ok", text: t("queue.copiedName") });
    } catch {
      setToast({ kind: "err", text: "No se pudo copiar" });
    }
  };

  return (
    <aside className="w-[220px] flex-shrink-0 flex flex-col border-r relative" style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}>
      <div className="p-3 border-b flex items-center justify-between" style={{ borderColor: "var(--border)" }}>
        <span className="text-[10px] font-semibold tracking-wider uppercase" style={{ color: "var(--text-dim)" }}>
          {t("queue.title")} ({queue.length})
        </span>
        <button onClick={handleAdd} className="cap-btn-secondary !p-1" title={t("queue.addVideos")}>
          <Plus size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {queue.map((item, idx) => {
          const ms = excelPath ? (excelMatchStatus[idx] || "unmatched") : "none";
          const isOpen = openMenuIdx === idx;
          return (
            <div key={idx}
              onClick={() => store.selectVideo(idx)}
              className="flex items-center gap-2 px-3 py-2 border-b cursor-pointer transition-colors group relative"
              style={{
                borderColor: "var(--border)",
                background: idx === selectedIdx ? "var(--bg-elevated)" : "transparent",
              }}>
              <Thumbnail value={item.thumbnail} status={item.status} />
              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: statusColors[item.status] }} />
              {excelPath && <MatchBadge status={ms} size={9} />}
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium truncate" style={{ color: "var(--text-primary)" }}>
                  {item.filename}
                </div>
                <div className="text-[10px] flex gap-2" style={{ color: "var(--text-dim)" }}>
                  {item.width > 0 && <span>{item.width}×{item.height}</span>}
                  {item.duration > 0 && <span>{fmtTime(item.duration)}</span>}
                </div>
              </div>
              <div className="flex items-center gap-1">
                {item.operations.length > 0 && (
                  <>
                    {item.operations.some(op => op.mode === "text") && (
                      <span className="text-[9px] px-1 py-0.5 rounded font-mono" style={{ background: "#a855f722", color: "#a855f7" }} title="Texto del batch">
                        T{item.operations.filter(op => op.mode === "text").length}
                      </span>
                    )}
                    {item.operations.some(op => op.mode !== "text") && (
                      <span className="text-[10px] w-5 h-5 rounded-full flex items-center justify-center font-mono" style={{ background: "var(--bg-app)", color: "var(--accent)" }}>
                        {item.operations.filter(op => op.mode !== "text").length}
                      </span>
                    )}
                  </>
                )}
                {idx === templateIdx && (
                  <Edit3 size={12} style={{ color: "#a855f7" }} title={t("queue.templateBadge")} />
                )}
                <button onClick={(e) => { e.stopPropagation(); setOpenMenuIdx(isOpen ? -1 : idx); }}
                  className="opacity-0 group-hover:opacity-100" style={{ color: "var(--text-dim)" }}
                  title={t("queue.contextMenu")}>
                  <MoreVertical size={12} />
                </button>
              </div>

              {isOpen && (
                <div ref={menuRef}
                  className="absolute right-2 top-full mt-1 z-30 rounded-md shadow-xl py-1 w-[200px]"
                  style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
                  onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => handleProcessThis(idx)} disabled={isProcessing}
                    className="w-full text-left px-3 py-1.5 text-[11px] flex items-center gap-2 hover:opacity-80 disabled:opacity-40"
                    style={{ color: "var(--text-primary)" }}>
                    <Play size={11} /> {t("queue.menu.processThis")}
                  </button>
                  {item.status === "error" && (
                    <button onClick={() => handleProcessThis(idx)} disabled={isProcessing}
                      className="w-full text-left px-3 py-1.5 text-[11px] flex items-center gap-2 hover:opacity-80 disabled:opacity-40"
                      style={{ color: "var(--accent)" }}>
                      <RotateCw size={11} /> {t("queue.menu.retry")}
                    </button>
                  )}
                  <div className="my-1 border-t" style={{ borderColor: "var(--border)" }} />
                  <button onClick={handleOpenOutputDir} disabled={!store.outputDir}
                    className="w-full text-left px-3 py-1.5 text-[11px] flex items-center gap-2 hover:opacity-80 disabled:opacity-40"
                    style={{ color: "var(--text-primary)" }}>
                    <FolderOpen size={11} /> {t("queue.menu.openFolder")}
                  </button>
                  <button onClick={() => handleReveal(idx)} disabled={!store.outputDir}
                    className="w-full text-left px-3 py-1.5 text-[11px] flex items-center gap-2 hover:opacity-80 disabled:opacity-40"
                    style={{ color: "var(--text-primary)" }}>
                    <Eye size={11} /> {t("queue.menu.showInExplorer")}
                  </button>
                  <button onClick={() => handleCopyName(idx)}
                    className="w-full text-left px-3 py-1.5 text-[11px] flex items-center gap-2 hover:opacity-80"
                    style={{ color: "var(--text-primary)" }}>
                    <Copy size={11} /> {t("queue.menu.copyName")}
                  </button>
                  <div className="my-1 border-t" style={{ borderColor: "var(--border)" }} />
                  <button onClick={() => { setOpenMenuIdx(-1); store.removeVideo(idx); }}
                    disabled={isProcessing}
                    className="w-full text-left px-3 py-1.5 text-[11px] flex items-center gap-2 hover:opacity-80 disabled:opacity-40"
                    style={{ color: "#f43f5e" }}>
                    <Trash2 size={11} /> {t("queue.menu.removeVideo")}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {toast && (
        <div className="absolute bottom-3 left-3 right-3 z-40 rounded-md px-3 py-2 text-[11px] flex items-center gap-2 shadow-lg"
          style={{
            background: toast.kind === "ok" ? "var(--bg-elevated)" : "var(--bg-elevated)",
            border: `1px solid ${toast.kind === "ok" ? "#22c55e" : toast.kind === "warn" ? "#fbbf24" : "#f43f5e"}`,
            color: toast.kind === "ok" ? "#22c55e" : toast.kind === "warn" ? "#fbbf24" : "#f43f5e",
          }}>
          <span className="flex-1">{toast.text}</span>
          <button onClick={() => setToast(null)} style={{ color: "inherit" }}><X size={11} /></button>
        </div>
      )}
    </aside>
  );
}
