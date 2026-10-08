import { useEffect, useRef, useState, Suspense } from "react";
import useEditorStore from "./stores/useEditorStore";
import useKeyboard from "./hooks/useKeyboard";
import useProcessing from "./hooks/useProcessing";
import Header from "./components/Header";
import AppRail from "./components/AppRail";
import QueueSidebar from "./components/QueueSidebar";
import VideoPreview from "./components/VideoPreview";
import { PropertiesPanel, LayerList } from "./components/editor-panels";
import StatusFooter from "./components/StatusFooter";
import LogoSidePanel from "./components/LogoSidePanel";
import DeferredPanel from "./components/DeferredPanel";
import PanelLoading from "./components/PanelLoading";
import { useT } from "./i18n/useT";
import {
  ShortcutsModal,
  TableEditor,
  ExcelMappingModal,
  WatermarkModal,
} from "./components/modal-panels";

const api = window.api;

export default function App() {
  const isDragging = useEditorStore((s) => s.isDragging);
  const setIsDragging = useEditorStore((s) => s.setIsDragging);
  const addVideos = useEditorStore((s) => s.addVideos);
  const loadPresets = useEditorStore((s) => s.loadPresets);
  const loadPresetsFromStorage = useEditorStore((s) => s.loadPresetsFromStorage);
  const loadSettings = useEditorStore((s) => s.loadSettings);
  const loadRecents = useEditorStore((s) => s.loadRecents);
  const ensurePetsReady = useEditorStore((s) => s.ensurePetsReady);
  const showToast = useEditorStore((s) => s.showToast);
  const isLogoMode = useEditorStore((s) => s.sidebarMode === "logo");
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
    const imagePaths = [];
    for (const item of queue || []) {
      for (const op of item?.operations || []) {
        if (op?.imagePath) imagePaths.push(op.imagePath);
        if (op?.delogoImagePath) imagePaths.push(op.delogoImagePath);
      }
    }
    if (watermark?.imagePath) imagePaths.push(watermark.imagePath);
    if (!outputDir && videoPaths.length === 0 && !excelPath) return;
    void api.restoreSessionPaths({ outputDir, videoPaths, imagePaths, excelPath });
  }, []);

  useEffect(() => {
    const settingsReady = loadSettings();
    loadRecents();
    void (async () => {
      await loadPresets();
      loadPresetsFromStorage();
      await settingsReady;
      const { petEnabled, petPoppedOut } = useEditorStore.getState();
      if (petEnabled || petPoppedOut) {
        await ensurePetsReady();
      }
    })();
  }, [loadPresets, loadPresetsFromStorage, loadSettings, loadRecents, ensurePetsReady]);

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
    if (!Array.from(e.dataTransfer?.types || []).includes("Files")) return;
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
      .map((f) => api?.getPathForFile?.(f) || f.path)
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
      className={`app-shell h-screen flex overflow-hidden${isDragging ? " is-file-dragging" : ""}`}
    >
      <AppRail />
      <div className="flex flex-col flex-1 min-w-0 min-h-0">
        <Header />
        <div className="app-canvas">
          {!isLogoMode && (
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
          )}
          <div
            className={`workspace-layout flex-1 flex overflow-hidden min-h-0${isLogoMode ? " workspace-layout--logo" : ""}`}
          >
            <div
              className={`workspace-panel workspace-panel--queue${mobilePanel === "queue" ? " is-mobile-active" : ""}`}
            >
              {isLogoMode ? <LogoSidePanel /> : <QueueSidebar />}
            </div>
            <div
              className={`workspace-panel workspace-panel--editor${mobilePanel === "editor" ? " is-mobile-active" : ""}`}
            >
              <VideoPreview />
            </div>
            {!isLogoMode && (
              <aside
                className={`workspace-panel workspace-panel--properties inspector w-[280px] flex-shrink-0 min-w-0 overflow-y-auto overflow-x-hidden border-l${mobilePanel === "properties" ? " is-mobile-active" : ""}`}
                style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}
              >
                <Suspense fallback={<PanelLoading label={t("workspace.properties")} />}>
                  <PropertiesPanel />
                  <LayerList />
                </Suspense>
              </aside>
            )}
          </div>
        </div>
        <StatusFooter />
      </div>
      <DeferredPanel
        when={(s) => s.showShortcuts}
        label={t("modal.shortcuts.title")}
        onClose={() => useEditorStore.getState().setShowShortcuts(false)}
      >
        <ShortcutsModal />
      </DeferredPanel>
      <DeferredPanel
        when={(s) => s.showTableEditor}
        label={t("table.title")}
        onClose={() => useEditorStore.getState().setShowTableEditor(false)}
      >
        <TableEditor />
      </DeferredPanel>
      <DeferredPanel
        when={(s) => s.showMappingModal}
        label={t("excel.title")}
        onClose={() => useEditorStore.getState().setShowMappingModal(false)}
      >
        <ExcelMappingModal />
      </DeferredPanel>
      <DeferredPanel
        when={(s) => s.showWatermarkModal}
        label={t("header.watermark")}
        onClose={() => useEditorStore.getState().setShowWatermarkModal(false)}
      >
        <WatermarkModal />
      </DeferredPanel>
    </div>
  );
}
