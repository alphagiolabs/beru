import { useEffect, useRef, useState, lazy, Suspense } from "react";
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
  const setIsDragging = useEditorStore((s) => s.setIsDragging);
  const addVideos = useEditorStore((s) => s.addVideos);
  const loadPresets = useEditorStore((s) => s.loadPresets);
  const loadPresetsFromStorage = useEditorStore((s) => s.loadPresetsFromStorage);
  const loadSettings = useEditorStore((s) => s.loadSettings);
  const loadRecents = useEditorStore((s) => s.loadRecents);
  const loadExecutionHistory = useEditorStore((s) => s.loadExecutionHistory);
  const ensurePetsReady = useEditorStore((s) => s.ensurePetsReady);
  const showToast = useEditorStore((s) => s.showToast);
  const t = useT();
  const [mobilePanel, setMobilePanel] = useState("editor");
  const dragDepthRef = useRef(0);
  const DRAG_DEPTH_MAX = 32;

  useKeyboard();
  useProcessing(api);

  useEffect(() => {
    if (!api?.restoreSessionPaths) return;
    const { outputDir, queue, excelPath, watermark } = useEditorStore.getState();
    const videoPaths = (queue || []).map((item) => item?.path).filter(Boolean);
    if (watermark?.imagePath) videoPaths.push(watermark.imagePath);
    if (!outputDir && videoPaths.length === 0 && !excelPath) return;
    void api.restoreSessionPaths({ outputDir, videoPaths, excelPath });
  }, []);

  useEffect(() => {
    const settingsReady = loadSettings();
    loadRecents();
    loadExecutionHistory();
    void (async () => {
      await loadPresets();
      loadPresetsFromStorage();
      await settingsReady;
      const { petEnabled, petPoppedOut } = useEditorStore.getState();
      if (petEnabled || petPoppedOut) {
        await ensurePetsReady();
      }
    })();
  }, [
    loadPresets,
    loadPresetsFromStorage,
    loadSettings,
    loadRecents,
    loadExecutionHistory,
    ensurePetsReady,
  ]);

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

    if (useEditorStore.getState().isProcessing) {
      showToast({ kind: "warn", text: t("queue.processingBusy") });
      return;
    }

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
      {...dropHandlers}
      className="h-screen flex flex-col overflow-hidden"
      style={{ background: "var(--bg-app)", color: "var(--text-primary)" }}
    >
      <Header />
      <nav className="mobile-workspace-nav" aria-label={t("workspace.navigation")}>
        {[
          ["queue", t("workspace.queue")],
          ["editor", t("workspace.editor")],
          ["properties", t("workspace.properties")],
        ].map(([panel, label]) => (
          <button
            key={panel}
            type="button"
            className={mobilePanel === panel ? "is-active" : ""}
            aria-current={mobilePanel === panel ? "page" : undefined}
            onClick={() => setMobilePanel(panel)}
          >
            {label}
          </button>
        ))}
      </nav>
      <div className="workspace-layout flex-1 flex overflow-hidden min-h-0">
        <div
          className={`workspace-panel workspace-panel--queue${mobilePanel === "queue" ? " is-mobile-active" : ""}`}
        >
          <QueueSidebar />
        </div>
        <div
          className={`workspace-panel workspace-panel--editor${mobilePanel === "editor" ? " is-mobile-active" : ""}`}
        >
          <VideoPreview />
          <ToolBar />
        </div>
        <aside
          className={`workspace-panel workspace-panel--properties inspector w-[280px] flex-shrink-0 min-w-0 overflow-y-auto overflow-x-hidden border-l${mobilePanel === "properties" ? " is-mobile-active" : ""}`}
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
