import { useState, useEffect, useRef } from "react";
import {
  Upload,
  Play,
  Square,
  FolderOutput,
  Undo2,
  Redo2,
  Settings,
  FlaskConical,
  X,
  FolderOpen,
  ExternalLink,
  Save,
  FolderInput,
  Library,
  ChevronDown,
  BookmarkPlus,
  Sun,
  Moon,
  Languages,
  History,
  Droplets,
} from "lucide-react";
import { shallow } from "zustand/shallow";
import { useT, SUPPORTED_LANGUAGES } from "../i18n/useT";
import useEditorStore from "../stores/useEditorStore";
import useCloseOnOutsideClick from "../hooks/useCloseOnOutsideClick";
import { resolveThemeName } from "../theme/engine.js";
import { importVideosFromDialog } from "../utils/import-videos";
import { queueCapacityInput } from "../utils/batch-capacity";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Button } from "./ui/Button";

const api = window.api;

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
    presets,
    themeActiveSlot,
    themeSlot1,
    themeSlot2,
    customThemes,
    language,
    recent,
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
      presets: s.presets,
      themeActiveSlot: s.themeActiveSlot,
      themeSlot1: s.themeSlot1,
      themeSlot2: s.themeSlot2,
      customThemes: s.customThemes,
      language: s.language,
      recent: s.recent,
      batchSummary: s.batchSummary,
    }),
    shallow,
  );
  const showToast = useEditorStore((s) => s.showToast);
  const canUndo = useEditorStore((s) => (s.undoStack?.length ?? 0) > 0);
  const canRedo = useEditorStore((s) => (s.redoStack?.length ?? 0) > 0);
  const capacityInput = useEditorStore(
    (s) => queueCapacityInput(s.queue, s.templateRegions),
    shallow,
  );
  const t = useT();
  const get = useEditorStore.getState;
  const [testResult, setTestResult] = useState(null);
  const [autoWorkerHint, setAutoWorkerHint] = useState(5);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [savePresetOpen, setSavePresetOpen] = useState(false);
  const [savePresetName, setSavePresetName] = useState("");
  const [recentOpen, setRecentOpen] = useState(false);
  const presetsRef = useRef(null);
  const savePresetInputRef = useRef(null);
  const recentRef = useRef(null);

  useCloseOnOutsideClick(presetsRef, presetsOpen, setPresetsOpen);
  useCloseOnOutsideClick(recentRef, recentOpen, setRecentOpen);

  useEffect(() => {
    if (!api?.getBatchCapacity) return undefined;
    let cancelled = false;
    let timer = 0;
    timer = setTimeout(() => {
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
  }, [
    capacityInput.queueLength,
    capacityInput.maxSourcePixels,
    capacityInput.hasVideoFilters,
    encodeProfile,
  ]);

  const flashToast = (kind, text) => showToast({ kind, text });

  const handleTogglePresets = async () => {
    if (!presetsOpen && presets.length === 0) {
      await get().loadPresets();
    }
    setPresetsOpen((v) => !v);
  };

  const handleApplyPreset = async (preset) => {
    setPresetsOpen(false);
    if (queueLength > 0) {
      const ok = await get().requestConfirm({
        message: t("header.confirmApplyPreset", { name: preset.name }),
      });
      if (!ok) return;
    }
    const res = get().applyPreset(preset.data);
    if (res.ok) flashToast("ok", t("header.presetApplied", { name: preset.name }));
    else flashToast("err", res.error || t("header.couldNotApply"));
  };

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

  const handleOpenRecent = async (entry) => {
    setRecentOpen(false);
    if (!entry?.path) return;
    if (queueLength > 0) {
      const ok = await get().requestConfirm({ message: t("header.confirmLoadRecent") });
      if (!ok) return;
    }
    const res = await get().loadProjectFromPath(entry.path);
    if (res.ok)
      flashToast(
        "ok",
        t("header.loadedFrom", { name: entry.name || entry.path.split(/[\\/]/).pop() }),
      );
    else if (res.error && /no encontrad|not found|missing/i.test(res.error))
      flashToast("err", t("header.recentMissing"));
    else flashToast("err", res.error || t("header.couldNotLoad"));
  };

  const handleRemoveRecent = async (e, entry) => {
    e.stopPropagation();
    await get().removeRecent(entry.path);
  };

  const handleSelectOutput = async () => {
    if (!api) {
      console.error("[beru] API not available");
      return;
    }
    try {
      const dir = await api.selectOutputDir();
      if (dir) {
        get().setOutputDir(dir);
      }
    } catch (err) {
      console.error("[beru] Error selecting output directory:", err);
    }
  };

  const handleAddVideos = async () => {
    await importVideosFromDialog({ api, store: get(), t, busy: isProcessing });
  };

  const handleProcessAll = async () => {
    const result = await get().processAll();
    if (!result || result.ok) return;
    if (result.code === "api_unavailable") {
      showToast({ kind: "err", text: t("errors.noApi") });
      return;
    }
    if (result.code === "busy") {
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
    if (!api || selectedIdx < 0) return;
    setTestResult({ status: "running" });
    const res = await get().processSingle(selectedIdx);
    setTestResult({
      status: res.ok ? "ok" : "error",
      outputPath: res.outputPath,
      error: res.error,
    });
  };

  const handleCancel = async () => {
    await get().cancelProcessing();
  };

  const canTest = !isProcessing && selectedIdx >= 0 && selectedIdx < queueLength;

  return (
    <header
      className="app-header cap-titlebar-drag flex flex-nowrap items-center gap-3 px-4 py-2 border-b flex-shrink-0"
      style={{
        background: "var(--bg-elevated)",
        borderColor: "var(--border)",
        paddingTop: "max(0.5rem, env(titlebar-area-height, 0px))",
      }}
    >
      <div className="app-header-brand flex flex-shrink-0 items-center gap-3">
        <svg viewBox="0 0 300 400" width="22" height="28" aria-label="Beru">
          <path
            fill="currentColor"
            fillRule="evenodd"
            d="M0 0L140 0C260 0 260 195 140 195L165 195C295 195 295 400 165 400L0 400ZM60 50L120 50C195 50 195 145 120 145L60 145ZM60 240L140 240C225 240 225 350 140 350L60 350ZM100 168L195 195L100 222Z"
          />
        </svg>
        <span className="text-sm font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>
          BERU
        </span>
      </div>

      <div
        data-testid="header-actions"
        className="app-header-actions flex min-w-0 flex-1 flex-nowrap items-center justify-end gap-2"
      >
        <Button
          onClick={handleAddVideos}
          disabled={isProcessing}
          variant="secondary"
          size="sm"
          className="header-primary-action text-[11px] whitespace-nowrap"
          title={t("header.importVideos")}
        >
          <Upload size={14} /> {t("header.importVideos")}
        </Button>

        <Button
          onClick={handleSelectOutput}
          disabled={isProcessing}
          variant="secondary"
          size="sm"
          className="header-primary-action text-[11px] whitespace-nowrap"
          title={outputDir ? `Salida: ${outputDir}` : t("header.selectOutput")}
        >
          <FolderOutput size={14} />{" "}
          {outputDir ? t("header.outputSelected") : t("header.selectOutput")}
        </Button>

        <select
          value={exportFormat}
          onChange={(e) => get().setExportFormat(e.target.value)}
          className="app-header-select app-header-select--format cap-input !w-[72px] !py-1 text-[11px]"
          aria-label={t("header.exportFormat")}
          disabled={isProcessing}
        >
          <option value="mp4">MP4</option>
          <option value="mov">MOV</option>
          <option value="avi">AVI</option>
        </select>

        <select
          value={encodeProfile}
          onChange={(e) => get().setEncodeProfile(e.target.value)}
          className="app-header-select app-header-select--profile cap-input !w-[116px] !py-1 text-[11px]"
          aria-label={t("header.encodeProfile")}
          disabled={isProcessing}
          title={t("header.encodeProfileHint")}
        >
          <option value="fast">{t("header.encodeFast")}</option>
          <option value="balanced">{t("header.encodeBalanced")}</option>
          <option value="quality">{t("header.encodeQuality")}</option>
          <option value="uquality">{t("header.encodeUltraQuality")}</option>
        </select>

        <select
          value={String(batchWorkers)}
          onChange={(e) => get().setBatchWorkers(e.target.value)}
          className="app-header-select app-header-select--workers cap-input !w-[88px] !py-1 text-[11px]"
          aria-label={t("header.workerCount")}
          disabled={isProcessing}
          title={t("header.batchWorkersHint")}
        >
          <option value="0">{t("header.workersAuto", { count: autoWorkerHint })}</option>
          <option value="1">1</option>
          <option value="2">2</option>
          <option value="3">3</option>
          <option value="4">4</option>
          <option value="5">5</option>
          <option value="6">6</option>
          <option value="8">8</option>
        </select>

        {batchSummary?.workers != null && !isProcessing && (
          <span
            className="text-[10px] whitespace-nowrap"
            style={{ color: "var(--text-dim)" }}
            title={t("header.workersLastRunHint")}
          >
            {t("header.workersLastRun", { count: batchSummary.workers })}
          </span>
        )}

        <select
          value={batchWorkersMode === "conservative" ? "conservative" : "balanced"}
          onChange={(e) => get().setBatchWorkersMode(e.target.value)}
          className="app-header-select app-header-select--workers-mode cap-input !w-[128px] !py-1 text-[11px]"
          aria-label={t("header.workerPolicy")}
          disabled={isProcessing || Number(batchWorkers) > 0}
          title={t("header.batchWorkersModeHint")}
        >
          <option value="balanced">{t("header.workersModeBalanced")}</option>
          <option value="conservative">{t("header.workersModeConservative")}</option>
        </select>

        <label
          className="flex items-center gap-1 text-[10px] cursor-pointer select-none whitespace-nowrap"
          style={{ color: "var(--text-dim)" }}
          title={t("header.batchRetryHint")}
        >
          <input
            type="checkbox"
            checked={batchRetryFailed}
            onChange={(e) => get().setBatchRetryFailed(e.target.checked)}
            disabled={isProcessing}
            className="w-3 h-3 accent-[var(--accent)]"
            aria-label={t("header.retryFailed")}
          />
          {t("header.batchRetry")}
        </label>

        <Button
          onClick={handleTestCurrent}
          disabled={!canTest}
          variant="secondary"
          size="sm"
          className="header-secondary-action text-[11px] whitespace-nowrap"
          title={t("header.processSelected")}
        >
          <FlaskConical size={14} /> {t("header.testRender")}
        </Button>

        {!isProcessing ? (
          <Button
            data-testid="header-process-all"
            onClick={handleProcessAll}
            disabled={queueLength === 0}
            variant="primary"
            className="header-process-action whitespace-nowrap"
          >
            <Play size={14} /> {t("header.processAll")}
          </Button>
        ) : (
          <Button
            onClick={handleCancel}
            variant="danger"
            className="header-process-action whitespace-nowrap"
          >
            <Square size={14} /> {t("header.cancel")}
          </Button>
        )}

        <div className="app-header-divider w-px h-5 mx-1" style={{ background: "var(--border)" }} />

        <Button
          onClick={get().undo}
          disabled={!canUndo}
          variant="secondary"
          size="icon"
          className="app-header-icon-btn"
          title={`${t("header.undo")} (Ctrl+Z)`}
        >
          <Undo2 size={14} />
        </Button>
        <Button
          onClick={get().redo}
          disabled={!canRedo}
          variant="secondary"
          size="icon"
          className="app-header-icon-btn"
          title={`${t("header.redo")} (Ctrl+Y)`}
        >
          <Redo2 size={14} />
        </Button>
        <div className="relative" ref={presetsRef}>
          <Button
            type="button"
            onClick={handleTogglePresets}
            variant="secondary"
            size="icon"
            className={`app-header-icon-btn header-presets-trigger${presetsOpen ? " is-open" : ""}`}
            title={t("header.presetsLibrary")}
            aria-haspopup="menu"
            aria-expanded={presetsOpen}
          >
            <Library size={14} />
            <ChevronDown
              size={10}
              className={`header-presets-chevron${presetsOpen ? " is-open" : ""}`}
            />
          </Button>
          {presetsOpen && (
            <div className="header-presets-menu" role="menu" aria-label={t("header.presets")}>
              <div className="header-presets-menu-chrome">
                <div className="header-presets-menu-title">{t("header.presets")}</div>
              </div>
              <div className="header-presets-menu-scroll">
                {presets.length === 0 ? (
                  <div className="header-presets-empty">
                    <Library size={16} strokeWidth={1.75} className="header-presets-empty-icon" />
                    <span>{t("header.noPresets")}</span>
                  </div>
                ) : (
                  presets.map((p, i) => {
                    const isBundled = p.source === "bundled";
                    const showSection = i === 0 || presets[i - 1].source !== p.source;
                    return (
                      <div key={`${p.source}-${p.filename}`} className="header-presets-group">
                        {showSection ? (
                          <div className="header-presets-section" aria-hidden="true">
                            {isBundled ? t("header.presetsBundled") : t("header.presetsCustom")}
                          </div>
                        ) : null}
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => handleApplyPreset(p)}
                          className="header-presets-item"
                        >
                          <div className="header-presets-item-row">
                            <span className="header-presets-item-name">{p.name}</span>
                            <span
                              className={`header-presets-tag${
                                isBundled
                                  ? " header-presets-tag--bundled"
                                  : " header-presets-tag--custom"
                              }`}
                            >
                              {isBundled ? t("header.presetBundled") : t("header.presetCustom")}
                            </span>
                          </div>
                          {p.description ? (
                            <span className="header-presets-item-desc">{p.description}</span>
                          ) : null}
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
        <Button
          onClick={handleLoadProject}
          disabled={isProcessing}
          variant="secondary"
          size="icon"
          className="app-header-icon-btn"
          title={t("header.loadProject")}
        >
          <FolderInput size={14} />
        </Button>
        <div className="relative" ref={recentRef}>
          <Button
            onClick={() => setRecentOpen((v) => !v)}
            variant="secondary"
            size="icon"
            className="app-header-icon-btn"
            title={t("header.recent")}
          >
            <History size={14} />
            <ChevronDown size={10} />
          </Button>
          {recentOpen && (
            <div
              className="absolute right-0 top-full mt-1 rounded shadow-lg z-50 w-[280px]"
              style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
            >
              {recent.length === 0 ? (
                <div className="px-3 py-2 text-[11px]" style={{ color: "var(--text-dim)" }}>
                  {t("header.noRecents")}
                </div>
              ) : (
                <div className="py-1 max-h-[280px] overflow-y-auto">
                  {recent.map((r) => (
                    <div
                      key={r.path}
                      onClick={() => handleOpenRecent(r)}
                      onKeyDown={(e) => {
                        if (e.target !== e.currentTarget) return;
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          handleOpenRecent(r);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      aria-label={r.name}
                      className="header-recent-item group flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:opacity-80"
                      style={{ opacity: r.exists === false ? 0.4 : 1 }}
                    >
                      <History
                        size={11}
                        style={{ color: "var(--text-dim)" }}
                        className="flex-shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <div
                          className="text-[11px] font-medium truncate"
                          style={{ color: "var(--text-primary)" }}
                        >
                          {r.name || r.path.split(/[\\/]/).pop()}
                        </div>
                        <div
                          className="text-[9px] truncate"
                          style={{ color: "var(--text-dim)" }}
                          title={r.path}
                        >
                          {r.path}
                        </div>
                      </div>
                      <button
                        onClick={(e) => handleRemoveRecent(e, r)}
                        className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-white/10 flex-shrink-0"
                        style={{ color: "var(--text-dim)" }}
                        title={t("common.remove")}
                      >
                        <X size={11} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <Button
          onClick={handleSaveProject}
          variant="secondary"
          size="icon"
          className="app-header-icon-btn"
          title={t("header.saveProject")}
        >
          <Save size={14} />
        </Button>
        <Button
          onClick={openSavePreset}
          variant="secondary"
          size="icon"
          className="app-header-icon-btn"
          title={t("header.savePreset")}
        >
          <BookmarkPlus size={14} />
        </Button>
        <Button
          onClick={() => get().toggleTheme()}
          onContextMenu={(e) => {
            e.preventDefault();
            get().setSettingsTab("appearance");
            get().setShowSettings(true);
          }}
          variant="secondary"
          size="icon"
          className={`app-header-icon-btn header-theme-toggle ${
            themeActiveSlot === 1 ? "header-theme-toggle--slot1" : "header-theme-toggle--slot2"
          }`}
          title={t("header.themeSwitchTo", {
            name: resolveThemeName(
              themeActiveSlot === 1 ? themeSlot2 : themeSlot1,
              customThemes,
              t,
            ),
          })}
        >
          {themeActiveSlot === 1 ? <Sun size={14} /> : <Moon size={14} />}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="app-header-icon-btn header-lang-trigger"
              title={t("header.language")}
            >
              <Languages size={14} />
              <span className="header-lang-code">{language.toUpperCase()}</span>
              <ChevronDown size={10} className="header-lang-chevron" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={6} className="min-w-[168px]">
            <DropdownMenuLabel>{t("header.language")}</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={language}
              onValueChange={(code) => get().setLanguage(code)}
            >
              {SUPPORTED_LANGUAGES.map((lng) => (
                <DropdownMenuRadioItem key={lng.code} value={lng.code}>
                  {lng.label}
                  <span className="header-lang-item-code">{lng.code.toUpperCase()}</span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          onClick={() => get().setShowWatermarkModal(true)}
          variant="secondary"
          size="icon"
          className="app-header-icon-btn"
          title={t("header.watermark")}
          disabled={isProcessing}
        >
          <Droplets size={15} />
        </Button>
        <Button
          onClick={() => get().setShowSettings(true)}
          variant="secondary"
          size="icon"
          className="app-header-icon-btn"
          title={t("header.settings")}
        >
          <Settings size={14} />
        </Button>
      </div>

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
                <p className="text-[11px] mb-3" style={{ color: "var(--rose)" }}>
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
