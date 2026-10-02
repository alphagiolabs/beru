import { useState, useEffect, useRef } from "react";
import {
  Upload,
  Play,
  Square,
  FolderOutput,
  Undo2,
  Redo2,
  FlaskConical,
  X,
  FolderOpen,
  ExternalLink,
  Save,
  FolderInput,
  BookmarkPlus,
} from "lucide-react";
import { shallow } from "zustand/shallow";
import { useT } from "../i18n/useT";
import useEditorStore from "../stores/useEditorStore";
import { importVideosFromDialog } from "../utils/import-videos";
import { queueCapacityInput, capacityJobsSignature } from "../utils/batch-capacity";
import { Button } from "./ui/Button";
import { Tooltip, TooltipProvider } from "./ui/tooltip";
import { Select } from "./ui/select";

const api = window.api;
const WORKER_COUNTS = [1, 2, 3, 4, 5, 6, 8];

export default function Header() {
  const {
    isProcessing,
    exportFormat,
    encodeProfile,
    batchWorkers,
    batchWorkersMode,
    batchRetryFailed,
    outputDir,
    queueLength,
    selectedIdx,
    batchSummary,
  } = useEditorStore(
    (s) => ({
      isProcessing: s.isProcessing,
      exportFormat: s.exportFormat,
      encodeProfile: s.encodeProfile,
      batchWorkers: s.batchWorkers,
      batchWorkersMode: s.batchWorkersMode,
      batchRetryFailed: s.batchRetryFailed,
      outputDir: s.outputDir,
      queueLength: s.queue.length,
      selectedIdx: s.selectedIdx,
      batchSummary: s.batchSummary,
    }),
    shallow,
  );
  const showToast = useEditorStore((s) => s.showToast);
  const canUndo = useEditorStore((s) => (s.undoStack?.length ?? 0) > 0);
  const canRedo = useEditorStore((s) => (s.redoStack?.length ?? 0) > 0);
  const capacitySig = useEditorStore((s) => capacityJobsSignature(s.queue, s.templateRegions));
  const t = useT();
  const get = useEditorStore.getState;
  const [testResult, setTestResult] = useState(null);
  const [autoWorkerHint, setAutoWorkerHint] = useState(5);
  const [savePresetOpen, setSavePresetOpen] = useState(false);
  const [savePresetName, setSavePresetName] = useState("");
  const savePresetInputRef = useRef(null);

  useEffect(() => {
    if (!api?.getBatchCapacity) return undefined;
    let cancelled = false;
    let timer = 0;
    timer = setTimeout(() => {
      const { queue, templateRegions } = get();
      const capacityInput = queueCapacityInput(queue, templateRegions);
      api
        .getBatchCapacity({
          jobCount: Math.max(1, capacityInput.queueLength),
          maxSourcePixels: capacityInput.maxSourcePixels,
          hasVideoFilters: capacityInput.hasVideoFilters,
          jobs: capacityInput.jobs,
          encodeProfile,
        })
        .then((cap) => {
          if (!cancelled && Number(cap?.recommended) > 0) {
            setAutoWorkerHint(cap.recommended);
          }
        })
        .catch(() => {});
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [capacitySig, encodeProfile, get]);

  const flashToast = (kind, text) => showToast({ kind, text });

  const handleSaveProject = async () => {
    const res = await get().saveProject();
    if (res.canceled) return;
    if (res.ok) flashToast("ok", t("header.savedAs", { name: res.filePath.split(/[\\/]/).pop() }));
    else flashToast("err", res.error || t("header.couldNotSave"));
  };

  const openSavePreset = () => {
    setSavePresetName("");
    setSavePresetOpen(true);
    setTimeout(() => savePresetInputRef.current?.focus(), 0);
  };

  const handleSavePresetSubmit = async () => {
    const name = savePresetName.trim();
    if (!name) return;
    const res = await get().savePreset(name);
    if (res.ok) {
      setSavePresetOpen(false);
      flashToast("ok", t("header.savedPresetAs", { name: res.fileName }));
    } else {
      flashToast("err", res.error || t("header.couldNotSavePreset"));
    }
  };

  const handleLoadProject = async () => {
    if (queueLength > 0) {
      const ok = await get().requestConfirm({ message: t("header.confirmLoadQueue") });
      if (!ok) return;
    }
    const res = await get().loadProject();
    if (res.canceled) return;
    if (res.ok)
      flashToast("ok", t("header.loadedFrom", { name: res.filePath.split(/[\\/]/).pop() }));
    else flashToast("err", res.error || t("header.couldNotLoad"));
  };

  const handleSelectOutput = async () => {
    if (!api) {
      showToast({ kind: "err", text: t("errors.noApi") });
      return;
    }
    try {
      const dir = await api.selectOutputDir();
      if (dir) {
        get().setOutputDir(dir);
      }
    } catch (err) {
      console.error("[beru] Error selecting output directory:", err);
      showToast({ kind: "err", text: t("errors.outputDirFailed") });
    }
  };

  const handleAddVideos = async () => {
    await importVideosFromDialog({ api, store: get(), t, busy: isProcessing });
  };

  const handleProcessAll = async () => {
    const result = await get().processAll();
    if (!result || result.ok || result.cancelled || result.superseded || result.notified) return;
    if (result.code === "api_unavailable") {
      showToast({ kind: "err", text: t("errors.noApi") });
      return;
    }
    if (result.code === "busy" || result.code === "already_processing") {
      showToast({ kind: "warn", text: t("queue.processingBusy") });
      return;
    }
    if (result.code === "missing_dimensions") {
      const missing = result.details.missing;
      const names = missing
        .slice(0, 3)
        .map((q) => q.filename)
        .join(", ");
      const more = missing.length > 3 ? ` (+${missing.length - 3})` : "";
      showToast({
        kind: "err",
        text: t("errors.missingVideoDimensions", { count: missing.length, names, more }),
      });
      return;
    }
    if (result.code === "missing_batch_text") {
      const missing = result.details.missing;
      const names = missing.slice(0, 3).join(", ");
      const more = missing.length > 3 ? ` (+${missing.length - 3})` : "";
      showToast({
        kind: "err",
        text: t("errors.batchTextMissing", { count: missing.length, names, more }),
      });
      return;
    }
    if (result.code === "no_jobs") {
      showToast({ kind: "warn", text: t("errors.noJobsToProcess") });
      return;
    }
    if (result.error && result.code == null) {
      showToast({
        kind: "err",
        text: t("errors.processStartFailed", { message: result.error }),
      });
    }
  };

  const handleTestCurrent = async () => {
    if (!api) {
      showToast({ kind: "err", text: t("errors.noApi") });
      return;
    }
    if (selectedIdx < 0) return;
    setTestResult({ status: "running" });
    const res = await get().processSingle(selectedIdx);
    if (res.superseded) return;
    if (res.cancelled || res.code === "already_processing") {
      setTestResult(null);
      if (res.code === "already_processing") {
        showToast({ kind: "warn", text: t("queue.processingBusy") });
      }
      return;
    }
    setTestResult({
      status: res.ok ? "ok" : "error",
      outputPath: res.outputPath,
      error: res.error,
    });
  };

  const handleCancel = async () => {
    await get().cancelProcessing();
  };

  const canTest = Boolean(api) && !isProcessing && selectedIdx >= 0 && selectedIdx < queueLength;

  return (
    <header className="app-header cap-titlebar-drag">
      <TooltipProvider>
        <div data-testid="header-actions" className="app-header-actions flex-nowrap">
          <div className="app-header-group">
            <Tooltip label={t("header.importVideos")}>
              <Button
                onClick={handleAddVideos}
                disabled={isProcessing}
                variant="tertiary"
                size="sm"
                aria-label={t("header.importVideos")}
              >
                <Upload size={13} />
                <span className="app-header-label">{t("header.importVideos")}</span>
              </Button>
            </Tooltip>
            <Tooltip
              label={outputDir ? t("header.outputSelected") : t("header.selectOutput")}
              description={outputDir || undefined}
            >
              <Button
                onClick={handleSelectOutput}
                disabled={isProcessing}
                variant="tertiary"
                size="sm"
                aria-label={t("header.selectOutput")}
              >
                <FolderOutput size={13} />
                <span className="app-header-label">
                  {outputDir ? t("header.outputSelected") : t("header.selectOutput")}
                </span>
              </Button>
            </Tooltip>
          </div>

          <div className="app-header-settings" role="group" aria-label={t("header.exportSettings")}>
            <Tooltip label={t("header.exportFormat")}>
              <Select
                variant="ghost"
                value={exportFormat}
                onValueChange={(v) => get().setExportFormat(v)}
                aria-label={t("header.exportFormat")}
                disabled={isProcessing}
                options={[
                  { value: "mp4", label: "MP4" },
                  { value: "mov", label: "MOV" },
                  { value: "avi", label: "AVI" },
                ]}
              />
            </Tooltip>
            <Tooltip label={t("header.encodeProfile")}>
              <Select
                variant="ghost"
                value={encodeProfile}
                onValueChange={(v) => get().setEncodeProfile(v)}
                aria-label={t("header.encodeProfile")}
                disabled={isProcessing}
                options={[
                  { value: "fast", label: t("header.encodeFast") },
                  { value: "balanced", label: t("header.encodeBalanced") },
                  { value: "quality", label: t("header.encodeQuality") },
                  { value: "uquality", label: t("header.encodeUltraQuality") },
                ]}
              />
            </Tooltip>
            <Tooltip label={t("header.workerCount")}>
              <Select
                variant="ghost"
                value={String(batchWorkers)}
                onValueChange={(v) => get().setBatchWorkers(v)}
                aria-label={t("header.workerCount")}
                disabled={isProcessing}
                options={[
                  { value: "0", label: t("header.workersAuto", { count: autoWorkerHint }) },
                  ...WORKER_COUNTS.map((n) => ({ value: String(n), label: String(n) })),
                ]}
              />
            </Tooltip>
            <Tooltip label={t("header.workerPolicy")}>
              <Select
                variant="ghost"
                value={batchWorkersMode === "conservative" ? "conservative" : "balanced"}
                onValueChange={(v) => get().setBatchWorkersMode(v)}
                aria-label={t("header.workerPolicy")}
                disabled={isProcessing || Number(batchWorkers) > 0}
                options={[
                  { value: "balanced", label: t("header.workersModeBalanced") },
                  { value: "conservative", label: t("header.workersModeConservative") },
                ]}
              />
            </Tooltip>
            <Tooltip label={t("header.retryFailed")}>
              <label className="app-header-check">
                <input
                  type="checkbox"
                  checked={batchRetryFailed}
                  onChange={(e) => get().setBatchRetryFailed(e.target.checked)}
                  disabled={isProcessing}
                  aria-label={t("header.retryFailed")}
                />
                <span className="app-header-label">{t("header.batchRetry")}</span>
              </label>
            </Tooltip>
          </div>

          {batchSummary?.workers != null && !isProcessing && (
            <Tooltip label={t("header.workersLastRunHint")}>
              <span className="app-header-meta">
                {t("header.workersLastRun", { count: batchSummary.workers })}
              </span>
            </Tooltip>
          )}

          <div className="app-header-group">
            <Tooltip label={t("header.processSelected")}>
              <Button
                onClick={handleTestCurrent}
                disabled={!canTest}
                variant="tertiary"
                size="sm"
                aria-label={t("header.processSelected")}
              >
                <FlaskConical size={13} />
                <span className="app-header-label">{t("header.testRender")}</span>
              </Button>
            </Tooltip>
            {!isProcessing ? (
              <Button
                data-testid="header-process-all"
                onClick={handleProcessAll}
                disabled={queueLength === 0}
                variant="primary"
                size="sm"
                className="app-header-process"
              >
                <Play size={12} /> {t("header.processAll")}
              </Button>
            ) : (
              <Button
                onClick={handleCancel}
                variant="danger"
                size="sm"
                className="app-header-process"
              >
                <Square size={12} /> {t("header.cancel")}
              </Button>
            )}
          </div>

          <span className="app-header-divider" aria-hidden />

          <div className="app-header-group">
            <Tooltip label={t("header.undo")} shortcut="Ctrl+Z">
              <Button
                onClick={get().undo}
                disabled={!canUndo}
                variant="tertiary"
                size="icon"
                className="app-header-icon-btn"
                aria-label={t("header.undo")}
              >
                <Undo2 size={13} />
              </Button>
            </Tooltip>
            <Tooltip label={t("header.redo")} shortcut="Ctrl+Y">
              <Button
                onClick={get().redo}
                disabled={!canRedo}
                variant="tertiary"
                size="icon"
                className="app-header-icon-btn"
                aria-label={t("header.redo")}
              >
                <Redo2 size={13} />
              </Button>
            </Tooltip>

            <span className="app-header-subdivider" aria-hidden />

            <Tooltip label={t("header.loadProject")}>
              <Button
                onClick={handleLoadProject}
                disabled={isProcessing}
                variant="tertiary"
                size="icon"
                className="app-header-icon-btn"
                aria-label={t("header.loadProject")}
              >
                <FolderInput size={13} />
              </Button>
            </Tooltip>
            <Tooltip label={t("header.saveProject")}>
              <Button
                onClick={handleSaveProject}
                variant="tertiary"
                size="icon"
                className="app-header-icon-btn"
                aria-label={t("header.saveProject")}
              >
                <Save size={13} />
              </Button>
            </Tooltip>
            <Tooltip label={t("header.savePreset")}>
              <Button
                onClick={openSavePreset}
                variant="tertiary"
                size="icon"
                className="app-header-icon-btn"
                aria-label={t("header.savePreset")}
              >
                <BookmarkPlus size={13} />
              </Button>
            </Tooltip>
          </div>
        </div>
      </TooltipProvider>

      {testResult && (
        <div
          className="cap-modal-overlay"
          onClick={() => testResult.status !== "running" && setTestResult(null)}
        >
          <div className="cap-modal-panel max-w-[420px] p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                {testResult.status === "running" && t("modal.testResult.running")}
                {testResult.status === "ok" && t("modal.testResult.ok")}
                {testResult.status === "error" && t("modal.testResult.error")}
              </h3>
              {testResult.status !== "running" && (
                <Button
                  onClick={() => setTestResult(null)}
                  variant="secondary"
                  size="icon"
                  title={t("common.close")}
                >
                  <X size={14} />
                </Button>
              )}
            </div>

            {testResult.status === "running" && (
              <div
                className="flex items-center gap-2 text-[12px]"
                style={{ color: "var(--text-secondary)" }}
              >
                <div
                  className="w-3 h-3 border-2 border-t-transparent rounded-full animate-spin"
                  style={{ borderColor: "var(--accent)", borderTopColor: "transparent" }}
                />
                {t("modal.testResult.processingWith")}
              </div>
            )}

            {testResult.status === "ok" && (
              <>
                <p className="text-[11px] mb-3 break-all" style={{ color: "var(--text-dim)" }}>
                  {testResult.outputPath}
                </p>
                <div className="flex gap-2 justify-end">
                  <Button
                    onClick={() => api?.openPath(testResult.outputPath)}
                    variant="primary"
                    size="sm"
                    className="text-[11px]"
                  >
                    <ExternalLink size={12} /> {t("modal.testResult.openVideo")}
                  </Button>
                  <Button
                    onClick={() => api?.showItemInFolder(testResult.outputPath)}
                    variant="secondary"
                    size="sm"
                    className="text-[11px]"
                  >
                    <FolderOpen size={12} /> {t("common.showInFolder")}
                  </Button>
                </div>
              </>
            )}

            {testResult.status === "error" && (
              <>
                <p className="text-[11px] mb-3" style={{ color: "var(--text-rose)" }}>
                  {testResult.error || t("modal.testResult.unknownError")}
                </p>
                <div className="flex justify-end">
                  <Button onClick={() => setTestResult(null)} variant="secondary" size="sm">
                    {t("common.close")}
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {savePresetOpen && (
        <div className="cap-modal-overlay" onClick={() => setSavePresetOpen(false)}>
          <div className="cap-modal-panel max-w-[380px] p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                {t("modal.savePreset.title")}
              </h3>
              <Button
                onClick={() => setSavePresetOpen(false)}
                variant="secondary"
                size="icon"
                title={t("common.close")}
              >
                <X size={14} />
              </Button>
            </div>
            <p className="text-[11px] mb-3" style={{ color: "var(--text-dim)" }}>
              {t("modal.savePreset.desc")}
            </p>
            <input
              ref={savePresetInputRef}
              type="text"
              value={savePresetName}
              onChange={(e) => setSavePresetName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSavePresetSubmit();
                if (e.key === "Escape") setSavePresetOpen(false);
              }}
              placeholder={t("modal.savePreset.placeholder")}
              className="w-full px-2 py-1.5 rounded text-[12px] mb-3 outline-none"
              style={{
                background: "var(--bg-app)",
                color: "var(--text-primary)",
                border: "1px solid var(--border)",
              }}
            />
            <div className="flex gap-2 justify-end">
              <Button onClick={() => setSavePresetOpen(false)} variant="secondary" size="sm">
                {t("common.cancel")}
              </Button>
              <Button
                onClick={handleSavePresetSubmit}
                disabled={!savePresetName.trim()}
                variant="primary"
                size="sm"
              >
                <BookmarkPlus size={12} /> {t("common.save")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
