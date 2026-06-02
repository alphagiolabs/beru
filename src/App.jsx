import { useEffect, useRef } from "react";
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
import TopUpdateBar from "./components/TopUpdateBar";
import AppToast from "./components/AppToast";
import { useT } from "./i18n/useT";

const api = window.api;

export default function App() {
  const queueLength = useEditorStore((s) => s.queue.length);
  const isDragging = useEditorStore((s) => s.isDragging);
  const hasSelection = useEditorStore(
    (s) => s.selectedIdx >= 0 && s.selectedIdx < s.queue.length,
  );
  const setIsDragging = useEditorStore((s) => s.setIsDragging);
  const addVideos = useEditorStore((s) => s.addVideos);
  const loadPresetsFromStorage = useEditorStore((s) => s.loadPresetsFromStorage);
  const loadSettings = useEditorStore((s) => s.loadSettings);
  const loadRecents = useEditorStore((s) => s.loadRecents);
  const applyUpdaterEvent = useEditorStore((s) => s.applyUpdaterEvent);
  const checkForUpdates = useEditorStore((s) => s.checkForUpdates);
  const showToast = useEditorStore((s) => s.showToast);
  const clearAppToast = useEditorStore((s) => s.clearAppToast);
  const appToast = useEditorStore((s) => s.appToast);
  const t = useT();
  const dropRef = useRef(null);
  const blobUrlsRef = useRef([]);
  const dragCounter = useRef(0);

  useKeyboard();
  useProcessing(api);

  useEffect(() => {
    loadPresetsFromStorage();
    loadSettings();
    loadRecents();
  }, [loadPresetsFromStorage, loadSettings, loadRecents]);

  useEffect(() => {
    if (!api?.onUpdaterEvent) return;
    const unsub = api.onUpdaterEvent((payload) => applyUpdaterEvent(payload));
    return () => { if (typeof unsub === "function") unsub(); };
  }, [applyUpdaterEvent]);

  useEffect(() => {
    if (!api?.checkForUpdates) return;
    const timer = setTimeout(() => { checkForUpdates(); }, 3000);
    return () => clearTimeout(timer);
  }, [checkForUpdates]);

  useEffect(() => {
    return () => {
      blobUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      blobUrlsRef.current = [];
    };
  }, []);

  useEffect(() => {
    if (!appToast) return;
    const timer = setTimeout(() => clearAppToast(), 3500);
    return () => clearTimeout(timer);
  }, [appToast, clearAppToast]);

  /* ── Drag & drop ──────────────────────────────────────────────── */
  const onDragEnter = (e) => {
    e.preventDefault();
    dragCounter.current += 1;
    if (dragCounter.current === 1) setIsDragging(true);
  };
  const onDragOver = (e) => { e.preventDefault(); };
  const onDragLeave = (e) => {
    e.preventDefault();
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) setIsDragging(false);
  };
  const onDrop = async (e) => {
    e.preventDefault();
    dragCounter.current = 0;
    setIsDragging(false);

    const rawPaths = Array.from(e.dataTransfer.files)
      .map((f) => f.path)
      .filter(Boolean);

    if (rawPaths.length === 0) {
      showToast({ kind: "warn", text: t("drop.noPaths") });
      return;
    }

    const res = await api?.resolveDroppedPaths(rawPaths);
    const videoPaths = res?.videoPaths || [];
    const ignored = res?.ignoredCount || 0;

    if (videoPaths.length === 0) {
      showToast({
        kind: "warn",
        text: t("drop.noVideos", { ignored: ignored ? String(ignored) : "" }),
      });
      return;
    }

    await addVideos(videoPaths, api);

    if (ignored > 0) {
      showToast({
        kind: "ok",
        text: t("drop.addedWithIgnored", { count: videoPaths.length, ignored }),
      });
    } else {
      showToast({
        kind: "ok",
        text: t("drop.added", { count: videoPaths.length }),
      });
    }
  };

  const dropHandlers = { onDragEnter, onDragOver, onDragLeave, onDrop };

  if (queueLength === 0) {
    return (
      <div ref={dropRef} {...dropHandlers} className="h-full">
        <TopUpdateBar />
        <Landing />
        <AppToast />
      </div>
    );
  }

  return (
    <div ref={dropRef} {...dropHandlers}
      className="h-screen flex flex-col overflow-hidden" style={{ background: "var(--bg-app)", color: "var(--text-primary)" }}>
      <TopUpdateBar />
      <Header />
      <BatchProgressBar />
      <div className="flex-1 flex overflow-hidden min-h-0">
        <QueueSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <VideoPreview />
          <ToolBar />
        </div>
        {hasSelection && (
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
      <AppToast />
    </div>
  );
}