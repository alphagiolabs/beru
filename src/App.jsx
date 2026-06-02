import { useEffect, useRef, useState } from "react";
import useEditorStore from "./stores/useEditorStore";
import useKeyboard from "./hooks/useKeyboard";
import useProcessing from "./hooks/useProcessing";
import Header from "./components/Header";
import QueueSidebar from "./components/QueueSidebar";
import VideoPreview from "./components/VideoPreview";
import ToolBar from "./components/ToolBar";
import PropertiesPanel from "./components/PropertiesPanel";
import LayerList from "./components/LayerList";
import BatchProgressBar from "./components/BatchProgressBar";
import DragOverlay from "./components/DragOverlay";
import ShortcutsModal from "./components/ShortcutsModal";
import TableEditor from "./components/TableEditor";
import ExcelMappingModal from "./components/ExcelMappingModal";
import Landing from "./components/Landing";
import UpdateBanner from "./components/UpdateBanner";

const api = window.api;

export default function App() {
  const store = useEditorStore();
  const dropRef = useRef(null);
  const blobUrlsRef = useRef([]);
  const dragCounter = useRef(0);
  const [dropToast, setDropToast] = useState(null);

  useKeyboard();
  useProcessing(api);

  useEffect(() => {
    store.loadPresetsFromStorage();
    store.loadSettings();
    store.loadRecents();
    const onLog = (e) => store.appendLog(e.detail);
    const onProgress = (e) => store.updateProcessingProgress(e.detail);
    const onComplete = (e) => store.markJobDone(e.detail);
    const onJobError = (e) => store.markJobError(e.detail);
    const onFinished = () => store.setProcessing(false);
    const onError = (e) => {
      store.setProcessing(false);
      console.error("[beru] Processing error:", e.detail);
    };
    const onSummary = (e) => {
      store.setBatchSummary(e.detail);
    };
    window.addEventListener("beru:log", onLog);
    window.addEventListener("beru:progress", onProgress);
    window.addEventListener("beru:complete", onComplete);
    window.addEventListener("beru:jobError", onJobError);
    window.addEventListener("beru:finished", onFinished);
    window.addEventListener("beru:error", onError);
    window.addEventListener("beru:summary", onSummary);
    return () => {
      window.removeEventListener("beru:log", onLog);
      window.removeEventListener("beru:progress", onProgress);
      window.removeEventListener("beru:complete", onComplete);
      window.removeEventListener("beru:jobError", onJobError);
      window.removeEventListener("beru:finished", onFinished);
      window.removeEventListener("beru:error", onError);
      window.removeEventListener("beru:summary", onSummary);
    };
  }, []);

  useEffect(() => {
    if (!api?.onUpdaterEvent) return;
    const unsub = api.onUpdaterEvent((payload) => store.applyUpdaterEvent(payload));
    return () => { if (typeof unsub === "function") unsub(); };
  }, []);

  useEffect(() => {
    if (!api?.checkForUpdates) return;
    const timer = setTimeout(() => { store.checkForUpdates(); }, 3000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    return () => {
      blobUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      blobUrlsRef.current = [];
    };
  }, []);

  useEffect(() => {
    if (!dropToast) return;
    const t = setTimeout(() => setDropToast(null), 3500);
    return () => clearTimeout(t);
  }, [dropToast]);

  /* ── Drag & drop ──────────────────────────────────────────────── */
  const onDragEnter = (e) => {
    e.preventDefault();
    dragCounter.current += 1;
    if (dragCounter.current === 1) store.setIsDragging(true);
  };
  const onDragOver = (e) => { e.preventDefault(); };
  const onDragLeave = (e) => {
    e.preventDefault();
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) store.setIsDragging(false);
  };
  const onDrop = async (e) => {
    e.preventDefault();
    dragCounter.current = 0;
    store.setIsDragging(false);

    // Collect paths from File objects (Electron adds .path)
    const rawPaths = Array.from(e.dataTransfer.files)
      .map((f) => f.path)
      .filter(Boolean);

    if (rawPaths.length === 0) {
      setDropToast({ kind: "warn", text: "No se detectaron rutas de archivos" });
      return;
    }

    // Resolve: directories → recursive scan, files → extension check
    const res = await api?.resolveDroppedPaths(rawPaths);
    const videoPaths = res?.videoPaths || [];
    const ignored = res?.ignoredCount || 0;

    if (videoPaths.length === 0) {
      setDropToast({ kind: "warn", text: `Sin videos en la selección${ignored ? ` (${ignored} ignorado${ignored === 1 ? "" : "s"})` : ""}` });
      return;
    }

    await store.addVideos(videoPaths, api);

    if (ignored > 0) {
      setDropToast({ kind: "ok", text: `${videoPaths.length} video${videoPaths.length === 1 ? "" : "s"} agregado${videoPaths.length === 1 ? "" : "s"} · ${ignored} ignorado${ignored === 1 ? "" : "s"}` });
    } else {
      setDropToast({ kind: "ok", text: `${videoPaths.length} video${videoPaths.length === 1 ? "" : "s"} agregado${videoPaths.length === 1 ? "" : "s"}` });
    }
  };

  const dropHandlers = { onDragEnter, onDragOver, onDragLeave, onDrop };

  if (store.queue.length === 0) {
    return (
      <div ref={dropRef} {...dropHandlers} className="h-full">
        <Landing />
        {dropToast && <DropToast toast={dropToast} />}
      </div>
    );
  }

  return (
    <div ref={dropRef} {...dropHandlers}
      className="h-screen flex flex-col overflow-hidden" style={{ background: "var(--bg-app)", color: "var(--text-primary)" }}>
      <Header />
      <BatchProgressBar />
      <div className="flex-1 flex overflow-hidden min-h-0">
        <QueueSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <VideoPreview />
          <ToolBar />
        </div>
        {store.selected() && (
          <aside className="w-[280px] flex-shrink-0 overflow-y-auto border-l" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
            <PropertiesPanel />
            <LayerList />
          </aside>
        )}
      </div>
      <DragOverlay />
      <ShortcutsModal />
      <TableEditor />
      <ExcelMappingModal />
      <UpdateBanner />
      {dropToast && <DropToast toast={dropToast} />}
    </div>
  );
}

function DropToast({ toast }) {
  const colors = toast.kind === "ok"
    ? { border: "#22c55e", fg: "#22c55e" }
    : { border: "#fbbf24", fg: "#fbbf24" };
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 rounded-md px-3 py-2 text-[11px] shadow-lg"
      style={{ background: "var(--bg-elevated)", border: `1px solid ${colors.border}`, color: colors.fg }}>
      {toast.text}
    </div>
  );
}
