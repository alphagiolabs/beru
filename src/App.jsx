import { useEffect, useRef, lazy, Suspense } from "react";
import useEditorStore from "./stores/useEditorStore";
import useKeyboard from "./hooks/useKeyboard";
import useProcessing from "./hooks/useProcessing";
import Header from "./components/Header";
import QueueSidebar from "./components/QueueSidebar";
import VideoPreview from "./components/VideoPreview";
import ToolBar from "./components/ToolBar";
import PropertiesPanel from "./components/PropertiesPanel";
import LayerList from "./components/LayerList";
import StatusFooter from "./components/StatusFooter";
import DragOverlay from "./components/DragOverlay";
import { useT } from "./i18n/useT";

const ShortcutsModal = lazy(() => import("./components/ShortcutsModal"));
const TableEditor = lazy(() => import("./components/TableEditor"));
const ExcelMappingModal = lazy(() => import("./components/ExcelMappingModal"));
const WatermarkModal = lazy(() => import("./components/WatermarkModal"));

const api = window.api;

export default function App() {
  const isDragging = useEditorStore((s) => s.isDragging);
  const setIsDragging = useEditorStore((s) => s.setIsDragging);
  const addVideos = useEditorStore((s) => s.addVideos);
  const loadPresetsFromStorage = useEditorStore((s) => s.loadPresetsFromStorage);
  const loadSettings = useEditorStore((s) => s.loadSettings);
  const loadRecents = useEditorStore((s) => s.loadRecents);
  const loadExecutionHistory = useEditorStore((s) => s.loadExecutionHistory);
  const ensurePetsReady = useEditorStore((s) => s.ensurePetsReady);
  const showToast = useEditorStore((s) => s.showToast);
  const t = useT();
  const dropRef = useRef(null);
  const dragDepthRef = useRef(0);
  const DRAG_DEPTH_MAX = 32;

  useKeyboard();
  useProcessing(api);

  useEffect(() => {
    loadPresetsFromStorage();
    const settingsReady = loadSettings();
    loadRecents();
    loadExecutionHistory();
    void (async () => {
      await settingsReady;
      const { petEnabled, petPoppedOut } = useEditorStore.getState();
      if (petEnabled || petPoppedOut) {
        await ensurePetsReady();
      }
    })();
  }, [loadPresetsFromStorage, loadSettings, loadRecents, loadExecutionHistory, ensurePetsReady]);

  useEffect(() => {
    const resetDragState = () => {
      dragDepthRef.current = 0;
      setIsDragging(false);
    };
    window.addEventListener("dragend", resetDragState);
    return () => window.removeEventListener("dragend", resetDragState);
  }, [setIsDragging]);

  const onDragEnter = (e) => {
    e.preventDefault();
    dragDepthRef.current = Math.min(dragDepthRef.current + 1, DRAG_DEPTH_MAX);
    if (dragDepthRef.current === 1) setIsDragging(true);
  };
  const onDragOver = (e) => {
    e.preventDefault();
  };
  const onDragLeave = (e) => {
    e.preventDefault();
    const related = e.relatedTarget;
    if (related && e.currentTarget.contains(related)) return;
    dragDepthRef.current = 0;
    setIsDragging(false);
  };
  const onDrop = async (e) => {
    e.preventDefault();
    dragDepthRef.current = 0;
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

  return (
    <div
      ref={dropRef}
      {...dropHandlers}
      className="h-screen flex flex-col overflow-hidden"
      style={{ background: "var(--bg-app)", color: "var(--text-primary)" }}
    >
      <Header />
      <div className="flex-1 flex overflow-hidden min-h-0">
        <QueueSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <VideoPreview />
          <ToolBar />
        </div>
        <aside
          className="inspector w-[280px] flex-shrink-0 min-w-0 overflow-y-auto overflow-x-hidden border-l"
          style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}
        >
          <PropertiesPanel />
          <LayerList />
        </aside>
      </div>
      <StatusFooter />
      <DragOverlay />
      <Suspense fallback={null}>
        <ShortcutsModal />
        <TableEditor />
        <ExcelMappingModal />
        <WatermarkModal />
      </Suspense>
    </div>
  );
}
