import { useEffect, useMemo, useState } from "react";
import { Download, FolderOpen, Save, X } from "lucide-react";
import { useT } from "../../i18n/useT";
import useEditorStore from "../../stores/useEditorStore";
import { Button } from "../../components/ui/Button";
import { Select } from "../../components/ui/select";
import { TooltipProvider } from "../../components/ui/tooltip";
import { layoutTrack } from "../../../shared/editor-timeline.js";
import { selectIsDirty, useTimelineStore } from "./store/useTimelineStore.js";
import { useEditorSession } from "./store/useEditorSession.js";
import {
  CANVAS_PRESETS,
  canvasPresetKey,
  evenDimension,
  isImageAsset,
  secondsToUs,
  setClipRange,
} from "./editor-model.js";
import {
  addImageLayerAt,
  addTitleAt,
  appendLibraryAsset,
  beginTimelineGesture,
  createPreviewProxy,
  duplicateTimelineClip,
  endTimelineGesture,
  exportComposition,
  importImageLayer,
  importSources,
  openDocument,
  relinkLibraryAsset,
  removeOverlayOf,
  removeTimelineClip,
  saveDocument,
  setCanvasBackground,
  setCanvasPreset,
  setCanvasSize,
  setMuteOfClip,
  setSpeedOfClip,
  setTransformOfClip,
  splitClipAtPlayhead,
  updateOverlayOf,
  writeAutosave,
} from "./editor-actions.js";
import EditorLibrary from "./EditorLibrary.jsx";
import EditorPreview from "./EditorPreview.jsx";
import EditorTimeline from "./EditorTimeline.jsx";
import ClipInspector from "./ClipInspector.jsx";
import OverlayInspector from "./OverlayInspector.jsx";
import ProjectInspector from "./ProjectInspector.jsx";
import { DEFAULT_PX_PER_SECOND, dropIndex } from "./timeline/geometry.js";
import useExactFrame from "./playback/useExactFrame.js";
import "./editor.css";

const AUTOSAVE_DELAY_MS = 2000;
const FRAME_US = 1_000_000 / 30;
const SECOND_US = 1_000_000;
const api = window.api;
let recoveryChecked = false;

const baseName = (filePath) => filePath.split(/[\\/]/).pop();

function isTextEntry(target) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

function isControl(target) {
  return target instanceof HTMLElement && ["BUTTON", "A"].includes(target.tagName);
}

export default function EditorWorkspace() {
  const t = useT();
  const showToast = useEditorStore((s) => s.showToast);
  const requestConfirm = useEditorStore((s) => s.requestConfirm);
  const project = useTimelineStore((s) => s.history.present);
  const revision = useTimelineStore((s) => s.revision);
  const dirty = useTimelineStore(selectIsDirty);
  const filePath = useTimelineStore((s) => s.filePath);
  const assetStatus = useTimelineStore((s) => s.assetStatus);
  const lastError = useTimelineStore((s) => s.lastError);
  const previewPaths = useTimelineStore((s) => s.previewPaths);
  const selectedClipId = useEditorSession((s) => s.selectedClipId);
  const selectedOverlayId = useEditorSession((s) => s.selectedOverlayId);
  const [audio, setAudio] = useState("original");
  const [encodeProfile, setEncodeProfile] = useState("balanced");
  const [exportPercent, setExportPercent] = useState(null);
  const [proxyBusy, setProxyBusy] = useState(false);
  const {
    frame: exactFrame,
    request: requestExactFrame,
    close: closeExactFrame,
  } = useExactFrame(api);

  const layout = useMemo(() => layoutTrack(project), [project]);
  const duration = layout.at(-1)?.endUs ?? 0;
  const assetsById = useMemo(
    () => Object.fromEntries(project.assets.map((a) => [a.id, a])),
    [project.assets],
  );
  const exportable =
    layout.length > 0 &&
    [
      ...layout.map((entry) => entry.clip.assetId),
      ...project.overlays.filter((o) => o.kind === "image").map((o) => o.assetId),
    ].every((assetId) => (assetStatus[assetId] ?? "ready") === "ready");
  const selectedEntry = layout.find((entry) => entry.clip.id === selectedClipId) ?? null;
  const selectedAsset = selectedEntry ? assetsById[selectedEntry.clip.assetId] : null;
  const selectedStatus = selectedAsset ? (assetStatus[selectedAsset.id] ?? "ready") : "ready";
  const selectedOverlay = project.overlays.find((o) => o.id === selectedOverlayId) ?? null;
  const notify = (kind, text) => showToast({ kind, text });

  useEffect(() => api?.onEditorExportProgress?.(({ percent }) => setExportPercent(percent)), []);

  useEffect(() => {
    if (!dirty) return undefined;
    const timer = setTimeout(() => {
      void writeAutosave(api).catch(() => {});
    }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [dirty, revision]);

  useEffect(() => {
    if (recoveryChecked || !api?.readEditorAutosave) return;
    recoveryChecked = true;
    void (async () => {
      const result = await api.readEditorAutosave();
      if (!result?.success || !result.autosave) return;
      const confirmed = await requestConfirm({
        title: t("editor.recover.title"),
        message: t("editor.recover.message", {
          time: new Date(result.autosave.savedAt).toLocaleString(),
        }),
        confirmLabel: t("editor.recover.confirm"),
        cancelLabel: t("editor.recover.discard"),
      });
      if (confirmed) useTimelineStore.getState().restoreUnsaved(result.autosave.project);
      else await api.clearEditorAutosave();
    })();
  }, [requestConfirm, t]);

  const handleOpen = async () => {
    const result = await openDocument(api);
    if (result.success) {
      useEditorSession.getState().reset();
      closeExactFrame();
      notify("ok", t("editor.opened", { name: baseName(result.filePath) }));
    } else if (!result.canceled) {
      notify("warn", result.error);
    }
  };

  const handleSave = async (saveAs = false) => {
    const result = await saveDocument(api, { saveAs });
    if (result.success) notify("ok", t("editor.saved", { name: baseName(result.filePath) }));
    else if (result.conflict) notify("warn", t("editor.conflict"));
    else if (!result.canceled) notify("warn", result.error);
  };

  const handleExport = async () => {
    setExportPercent(0);
    try {
      const result = await exportComposition(api, { audio, encodeProfile });
      if (result.success) notify("ok", t("editor.exported", { name: baseName(result.filePath) }));
      else if (!result.canceled && !result.cancelled) notify("warn", result.error);
    } finally {
      setExportPercent(null);
    }
  };

  const handleImport = async () => {
    const result = await importSources(api);
    if (result.canceled) return;
    if (!result.success) {
      notify("warn", result.error);
      return;
    }
    if (result.errors.length > 0) {
      notify("warn", t("editor.importErrors", { count: result.errors.length }));
    }
  };

  const handleAppend = (assetId, index = null) => {
    if (!appendLibraryAsset(assetId, index)) return;
    const next = layoutTrack(useTimelineStore.getState().history.present);
    const inserted = index == null ? next.at(-1) : next[index];
    if (inserted) useEditorSession.getState().selectClip(inserted.clip.id);
  };

  const handleCanvasSize = (width, height) => {
    setCanvasSize(evenDimension(width), evenDimension(height));
  };

  const handleAddTitle = () => {
    const overlayId = addTitleAt(
      useEditorSession.getState().playhead,
      t("editor.overlay.defaultText"),
    );
    if (overlayId) useEditorSession.getState().selectOverlay(overlayId);
  };

  const handleAddImage = async () => {
    const result = await importImageLayer(api, useEditorSession.getState().playhead);
    if (result.canceled) return;
    if (!result.success) {
      notify("warn", result.error);
      return;
    }
    useEditorSession.getState().selectOverlay(result.overlayId);
  };

  const handleAddLayer = (assetId, startUs = useEditorSession.getState().playhead) => {
    const overlayId = addImageLayerAt(assetId, startUs);
    if (overlayId) useEditorSession.getState().selectOverlay(overlayId);
  };

  const removeSelectedOverlay = () => {
    if (selectedOverlay && removeOverlayOf(selectedOverlay.id)) {
      useEditorSession.getState().selectOverlay(null);
    }
  };

  const handleCreateProxy = async (proxyAsset, { automatic = false } = {}) => {
    setProxyBusy(true);
    try {
      const result = await createPreviewProxy(api, proxyAsset);
      if (!result.success) notify("warn", result.error);
      else if (automatic) notify("ok", t("editor.proxy.automatic", { name: proxyAsset.filename }));
    } finally {
      setProxyBusy(false);
    }
  };

  const handleRelink = async (assetId) => {
    const result = await relinkLibraryAsset(api, assetId);
    if (!result.success && !result.canceled) notify("warn", result.error);
  };

  const commitRange = (inSeconds, outSeconds) => {
    if (!selectedEntry) return;
    const { sourceInUs, sourceOutUs } = selectedEntry.clip;
    if (secondsToUs(inSeconds) === sourceInUs && secondsToUs(outSeconds) === sourceOutUs) return;
    useTimelineStore
      .getState()
      .apply((p) => setClipRange(p, selectedEntry.clip.id, inSeconds, outSeconds));
  };

  const handleTransform = (patch, options) => {
    if (!selectedEntry) return;
    setTransformOfClip(selectedEntry.clip.id, patch, options);
  };

  const handleInspectorGesture = (phase) => {
    if (phase === "start") beginTimelineGesture();
    else endTimelineGesture();
  };

  const splitAtPlayhead = () => {
    const playhead = useEditorSession.getState().playhead;
    const split = splitClipAtPlayhead(playhead);
    if (!split) {
      notify("warn", t("editor.timeline.noClipAtPlayhead"));
      return;
    }
    useEditorSession.getState().selectClip(split.leftId);
  };

  const duplicateSelected = () => {
    if (!selectedEntry) return;
    const copyId = duplicateTimelineClip(selectedEntry.clip.id);
    if (copyId) useEditorSession.getState().selectClip(copyId);
  };

  const removeSelected = () => {
    if (selectedOverlay) {
      removeSelectedOverlay();
      return;
    }
    if (!selectedEntry) return;
    const index = layout.findIndex((entry) => entry.clip.id === selectedEntry.clip.id);
    const neighbour = layout[index + 1]?.clip.id ?? layout[index - 1]?.clip.id ?? null;
    if (removeTimelineClip(selectedEntry.clip.id))
      useEditorSession.getState().selectClip(neighbour);
  };

  useEffect(() => {
    const onKeyDown = (event) => {
      const store = useTimelineStore.getState();
      const session = useEditorSession.getState();
      const key = event.key.toLowerCase();
      if (isTextEntry(event.target)) return;
      if (event.ctrlKey || event.metaKey) {
        if (key === "s") {
          event.preventDefault();
          void handleSave(event.shiftKey);
        } else if (key === "o") {
          event.preventDefault();
          void handleOpen();
        } else if (key === "z" && !event.shiftKey) {
          event.preventDefault();
          store.undo();
        } else if (key === "y" || (key === "z" && event.shiftKey)) {
          event.preventDefault();
          store.redo();
        }
        return;
      }
      if (isControl(event.target) || store.history.gesture) return;
      if (event.code === "Space") {
        event.preventDefault();
        session.setPlaying(!session.playing);
      } else if (key === "s") {
        splitAtPlayhead();
      } else if (key === "d") {
        duplicateSelected();
      } else if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        removeSelected();
      } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const step = event.shiftKey ? SECOND_US : FRAME_US;
        const direction = event.key === "ArrowLeft" ? -1 : 1;
        session.setPlaying(false);
        session.setPlayhead(Math.min(duration, Math.max(0, session.playhead + direction * step)));
      } else if (event.key === "Home") {
        session.setPlaying(false);
        session.setPlayhead(0);
      } else if (event.key === "End") {
        session.setPlaying(false);
        session.setPlayhead(duration);
      } else if (event.key === "+" || event.key === "=") {
        session.setZoom(session.pxPerSecond * 1.5);
      } else if (event.key === "-") {
        session.setZoom(session.pxPerSecond / 1.5);
      } else if (event.key === "0") {
        session.setZoom(DEFAULT_PX_PER_SECOND);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const title = filePath ? baseName(filePath) : t("editor.untitled");

  return (
    <TooltipProvider>
      <div className="editor-workspace">
        <div
          className="editor-toolbar cap-titlebar-drag"
          role="toolbar"
          aria-label={t("editor.title")}
        >
          <div className="editor-toolbar-group">
            <Button variant="tertiary" size="sm" onClick={handleOpen}>
              <FolderOpen size={14} strokeWidth={1.75} />
              {t("editor.open")}
            </Button>
            <Button
              variant="tertiary"
              size="sm"
              onClick={() => handleSave(false)}
              disabled={!dirty && Boolean(filePath)}
            >
              <Save size={14} strokeWidth={1.75} />
              {t("editor.save")}
            </Button>
            <Button variant="tertiary" size="sm" onClick={() => handleSave(true)}>
              {t("editor.saveAs")}
            </Button>
          </div>
          <div className="editor-doc" title={filePath ?? undefined}>
            <span className="editor-doc-name">{title}</span>
            {dirty ? <span className="editor-dirty" aria-hidden /> : null}
          </div>
          <div className="editor-toolbar-group editor-toolbar-end">
            {exportPercent == null ? (
              <Button
                variant="primary"
                size="sm"
                disabled={!exportable}
                title={!exportable && layout.length > 0 ? t("editor.exportBlocked") : undefined}
                onClick={handleExport}
              >
                <Download size={14} strokeWidth={1.75} />
                {t("editor.export")}
              </Button>
            ) : (
              <>
                <progress
                  className="editor-progress"
                  max={100}
                  value={exportPercent}
                  aria-label={t("editor.exporting")}
                />
                <Button variant="secondary" size="sm" onClick={() => api.cancelEditorExport()}>
                  <X size={14} strokeWidth={1.75} />
                  {t("editor.exportCancel")}
                </Button>
              </>
            )}
          </div>
        </div>

        {lastError ? (
          <div role="alert" className="editor-error">
            <span>{lastError}</span>
            <button
              type="button"
              className="editor-icon-button"
              onClick={() => useTimelineStore.getState().clearError()}
              aria-label={t("common.close")}
            >
              <X size={14} strokeWidth={1.75} />
            </button>
          </div>
        ) : null}

        <div className="editor-body">
          <EditorLibrary
            assets={project.assets}
            assetStatus={assetStatus}
            usedAssetIds={new Set(layout.map((entry) => entry.clip.assetId))}
            onImport={handleImport}
            onAppend={handleAppend}
            onAddLayer={handleAddLayer}
            onRelink={handleRelink}
          />
          <EditorPreview
            layout={layout}
            duration={duration}
            canvas={project.canvas}
            fps={project.fps.num / project.fps.den}
            overlays={project.overlays}
            assetsById={assetsById}
            assetStatus={assetStatus}
            previewPaths={previewPaths}
            proxyBusy={proxyBusy}
            onCreateProxy={handleCreateProxy}
            exactFrame={exactFrame}
            onExactFrame={() => requestExactFrame(useEditorSession.getState().playhead)}
            onCloseExactFrame={closeExactFrame}
            canvasControl={
              <Select
                variant="ghost"
                size="sm"
                value={canvasPresetKey(project.canvas)}
                onValueChange={(key) => {
                  if (key === "custom") useEditorSession.getState().selectClip(null);
                  else setCanvasPreset(key);
                }}
                aria-label={t("editor.canvas")}
                options={[
                  ...Object.keys(CANVAS_PRESETS).map((key) => ({ value: key, label: key })),
                  { value: "custom", label: t("editor.canvasCustom") },
                ]}
              />
            }
          />
          <aside className="editor-side">
            {selectedOverlay ? (
              <OverlayInspector
                overlay={selectedOverlay}
                asset={
                  selectedOverlay.kind === "image" ? assetsById[selectedOverlay.assetId] : null
                }
                onUpdate={(patch) => updateOverlayOf(selectedOverlay.id, patch)}
                onRemove={removeSelectedOverlay}
              />
            ) : selectedEntry ? (
              <ClipInspector
                entry={selectedEntry}
                asset={selectedAsset}
                onCommitRange={selectedStatus === "ready" ? commitRange : null}
                onSpeed={(speed) => setSpeedOfClip(selectedEntry.clip.id, speed)}
                onMute={(muted) => setMuteOfClip(selectedEntry.clip.id, muted)}
                onTransform={handleTransform}
                onGesture={handleInspectorGesture}
              />
            ) : (
              <ProjectInspector
                canvas={project.canvas}
                onCanvasSize={handleCanvasSize}
                onBackground={setCanvasBackground}
                audio={audio}
                onAudio={setAudio}
                encodeProfile={encodeProfile}
                onEncodeProfile={setEncodeProfile}
              />
            )}
          </aside>
          <EditorTimeline
            layout={layout}
            duration={duration}
            assetsById={assetsById}
            assetStatus={assetStatus}
            overlays={project.overlays}
            onAddTitle={handleAddTitle}
            onAddImage={handleAddImage}
            onSplit={splitAtPlayhead}
            onDuplicate={duplicateSelected}
            onDelete={removeSelected}
            onImport={handleImport}
            onDropAsset={(assetId, timeUs) => {
              if (isImageAsset(assetsById[assetId])) handleAddLayer(assetId, timeUs);
              else handleAppend(assetId, dropIndex(layout, timeUs, null));
            }}
          />
        </div>
      </div>
    </TooltipProvider>
  );
}
