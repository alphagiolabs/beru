import { useState, useEffect, useRef, useCallback } from "react";
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
import { hasVideoDimensions } from "../utils/batch-process";
import { buildExportJobs } from "../utils/export-pipeline";
import { validateBatchReady, runBatch, cancelBatch } from "../utils/batch-runner";
import { resolveThemeName } from "../theme/engine.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

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
    templateRegions,
    selectedIdx,
    presets,
    themeActiveSlot,
    themeSlot1,
    themeSlot2,
    customThemes,
    language,
    recent,
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
      templateRegions: s.templateRegions,
      selectedIdx: s.selectedIdx,
      presets: s.presets,
      themeActiveSlot: s.themeActiveSlot,
      themeSlot1: s.themeSlot1,
      themeSlot2: s.themeSlot2,
      customThemes: s.customThemes,
      language: s.language,
      recent: s.recent,
    }),
    shallow,
  );
  const showToast = useEditorStore((s) => s.showToast);
  const canUndo = useEditorStore((s) => (s.undoStack?.length ?? 0) > 0);
  const canRedo = useEditorStore((s) => (s.redoStack?.length ?? 0) > 0);
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

  const setPresetsOpenStable = useCallback((v) => setPresetsOpen(v), []);
  const setRecentOpenStable = useCallback((v) => setRecentOpen(v), []);

  useCloseOnOutsideClick(presetsRef, presetsOpen, setPresetsOpenStable);
  useCloseOnOutsideClick(recentRef, recentOpen, setRecentOpenStable);

  useEffect(() => {
    if (!api?.getBatchCapacity) return undefined;
    let cancelled = false;
    let timer = 0;
    // Debounce: queue/template/profile can change in rapid bursts (e.g. when
    // importing many videos or applying a preset); coalesce into one IPC call.
    timer = setTimeout(() => {
      const currentQueue = get().queue;
      const jobCount = Math.max(1, currentQueue.length);
      let maxSourcePixels = 0;
      for (const item of currentQueue) {
        const w = Number(item.sourceWidth || item.width || 0);
        const h = Number(item.sourceHeight || item.height || 0);
        if (w > 0 && h > 0) maxSourcePixels = Math.max(maxSourcePixels, w * h);
      }
      const hasVideoFilters =
        templateRegions.length > 0 ||
        currentQueue.some((item) => (item.operations || []).length > 0);
      api
        .getBatchCapacity({ jobCount, maxSourcePixels, hasVideoFilters, encodeProfile })
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
  }, [queueLength, templateRegions, encodeProfile]);

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
    if (get().isProcessing) {
      showToast({ kind: "warn", text: t("queue.processingBusy") });
      return;
    }
    if (!api?.openVideos) {
      showToast({ kind: "err", text: t("errors.noApi") });
      return;
    }
    try {
      const paths = await api.openVideos();
      if (!paths?.length) return;
      await get().addVideos(paths, api);
      showToast({ kind: "ok", text: t("drop.added", { count: paths.length }) });
    } catch (err) {
      console.error("[beru] Video import failed:", err);
      showToast({
        kind: "err",
        text: t("errors.importVideosFailed", {
          message: err?.message || t("errors.unknown"),
        }),
      });
    }
  };

  const handleProcessAll = async () => {
    if (!api?.startProcessing) {
      showToast({ kind: "err", text: t("errors.noApi") });
      return;
    }
    const { templateRegions, sidebarMode } = get();
    if (sidebarMode === "batch" || templateRegions.length > 0) {
      get().materializeBatchTextOps();
    }

    let queueForProcessing = get().queue;
    if (queueForProcessing.some((q) => !hasVideoDimensions(q))) {
      queueForProcessing = await get().refreshMissingVideoInfo(api);
    }

    // processSingle re-checks after the same await; mirror that so double-click
    // during dimension refresh cannot start two concurrent runBatch paths.
    if (get().isProcessing) {
      showToast({ kind: "warn", text: t("queue.processingBusy") });
      return;
    }

    const validation = validateBatchReady({
      queue: queueForProcessing,
      templateRegions,
      getCellText: (videoIdx, regionId) => get().getCellTextForRegion(videoIdx, regionId),
    });
    if (!validation.ok) {
      if (validation.code === "missing_dimensions") {
        const missing = validation.details.missing;
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
      if (validation.code === "missing_batch_text") {
        const missing = validation.details.missing;
        const names = missing.slice(0, 3).join(", ");
        const more = missing.length > 3 ? ` (+${missing.length - 3})` : "";
        showToast({
          kind: "err",
          text: t("errors.batchTextMissing", { count: missing.length, names, more }),
        });
        return;
      }
      return;
    }

    const jobs = buildExportJobs(queueForProcessing, (q, i) => get()._buildJobFor(q, i));
    // Fire-and-forget like before: process:start resolves when the batch ends.
    void runBatch({
      api,
      jobs,
      queue: get().queue,
      hooks: {
        startExecutionRun: (opts) => get().startExecutionRun(opts),
        applyPatch: (patch) => useEditorStore.setState(patch),
        setProcessing: (val) => get().setProcessing(val),
        finalizeActiveExecution: (summary) => get().finalizeActiveExecution(summary),
      },
    }).then((result) => {
      if (!result.ok) {
        if (result.code === "no_jobs") {
          showToast({ kind: "warn", text: t("errors.noJobsToProcess") });
          return;
        }
        // Runtime failures are toasted via useProcessing → onError; only pre-spawn errors here.
        if (result.error && result.code == null) {
          showToast({
            kind: "err",
            text: t("errors.processStartFailed", { message: result.error }),
          });
        }
      }
    });
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
    await cancelBatch({
      api,
      hooks: {
        abortActiveProcessing: () => get().abortActiveProcessing(),
      },
    });
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
        <button
          onClick={handleAddVideos}
          disabled={isProcessing}
          className="cap-btn-secondary text-[11px] whitespace-nowrap"
        >
          <Upload size={14} /> Importar
        </button>

        <button
          onClick={handleSelectOutput}
          disabled={isProcessing}
          className="cap-btn-secondary text-[11px] whitespace-nowrap"
          title={outputDir ? `Salida: ${outputDir}` : t("header.selectOutput")}
        >
          <FolderOutput size={14} /> {outputDir ? "Salida ✓" : t("header.selectOutput")}
        </button>

        <select
          value={exportFormat}
          onChange={(e) => get().setExportFormat(e.target.value)}
          className="app-header-select app-header-select--format cap-input !w-[72px] !py-1 text-[11px]"
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

        <select
          value={batchWorkersMode === "conservative" ? "conservative" : "balanced"}
          onChange={(e) => get().setBatchWorkersMode(e.target.value)}
          className="app-header-select app-header-select--workers-mode cap-input !w-[128px] !py-1 text-[11px]"
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
          />
          {t("header.batchRetry")}
        </label>

        <button
          onClick={handleTestCurrent}
          disabled={!canTest}
          className="cap-btn-secondary text-[11px] whitespace-nowrap"
          title={
            canTest ? "Renderiza sólo el video seleccionado" : "Selecciona un video de la lista"
          }
        >
          <FlaskConical size={14} /> {t("header.testRender")}
        </button>

        {!isProcessing ? (
          <button
            data-testid="header-process-all"
            onClick={handleProcessAll}
            disabled={queueLength === 0}
            className="cap-btn-primary whitespace-nowrap"
          >
            <Play size={14} /> {t("header.processAll")}
          </button>
        ) : (
          <button onClick={handleCancel} className="cap-btn-danger whitespace-nowrap">
            <Square size={14} /> {t("header.cancel")}
          </button>
        )}

        <div className="app-header-divider w-px h-5 mx-1" style={{ background: "var(--border)" }} />

        <button
          onClick={get().undo}
          disabled={!canUndo}
          className="cap-btn-secondary app-header-icon-btn !p-1.5"
          title={`${t("header.undo")} (Ctrl+Z)`}
        >
          <Undo2 size={14} />
        </button>
        <button
          onClick={get().redo}
          disabled={!canRedo}
          className="cap-btn-secondary app-header-icon-btn !p-1.5"
          title={`${t("header.redo")} (Ctrl+Y)`}
        >
          <Redo2 size={14} />
        </button>
        <div className="relative" ref={presetsRef}>
          <button
            type="button"
            onClick={handleTogglePresets}
            className={`cap-btn-secondary app-header-icon-btn header-presets-trigger !p-1.5${
              presetsOpen ? " is-open" : ""
            }`}
            title={t("header.presetsLibrary")}
            aria-haspopup="menu"
            aria-expanded={presetsOpen}
          >
            <Library size={14} />
            <ChevronDown
              size={10}
              className={`header-presets-chevron${presetsOpen ? " is-open" : ""}`}
            />
          </button>
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
        <button
          onClick={handleLoadProject}
          disabled={isProcessing}
          className="cap-btn-secondary app-header-icon-btn !p-1.5"
          title={t("header.loadProject")}
        >
          <FolderInput size={14} />
        </button>
        <div className="relative" ref={recentRef}>
          <button
            onClick={() => setRecentOpen((v) => !v)}
            className="cap-btn-secondary app-header-icon-btn !p-1.5"
            title={t("header.recent")}
          >
            <History size={14} />
            <ChevronDown size={10} />
          </button>
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
                      className="group flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:opacity-80"
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
        <button
          onClick={handleSaveProject}
          className="cap-btn-secondary app-header-icon-btn !p-1.5"
          title={t("header.saveProject")}
        >
          <Save size={14} />
        </button>
        <button
          onClick={openSavePreset}
          className="cap-btn-secondary app-header-icon-btn !p-1.5"
          title={t("header.savePreset")}
        >
          <BookmarkPlus size={14} />
        </button>
        <button
          onClick={() => get().toggleTheme()}
          onContextMenu={(e) => {
            e.preventDefault();
            get().setSettingsTab("appearance");
            get().setShowSettings(true);
          }}
          className={`cap-btn-secondary app-header-icon-btn !p-1.5 header-theme-toggle ${
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
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="cap-btn-secondary app-header-icon-btn header-lang-trigger !p-1.5"
              title={t("header.language")}
            >
              <Languages size={14} />
              <span className="header-lang-code">{language.toUpperCase()}</span>
              <ChevronDown size={10} className="header-lang-chevron" />
            </button>
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
        <button
          onClick={() => get().setShowWatermarkModal(true)}
          className="cap-btn-secondary app-header-icon-btn !p-1.5"
          title="Marca de agua"
          disabled={isProcessing}
        >
          <Droplets size={15} />
        </button>
        <button
          onClick={() => get().setShowSettings(true)}
          className="cap-btn-secondary app-header-icon-btn !p-1.5"
          title={t("header.settings")}
        >
          <Settings size={14} />
        </button>
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
                <button
                  onClick={() => setTestResult(null)}
                  className="cap-btn-secondary !p-1"
                  title="Cerrar"
                >
                  <X size={14} />
                </button>
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
                  <button
                    onClick={() => api?.openPath(testResult.outputPath)}
                    className="cap-btn-primary text-[11px]"
                  >
                    <ExternalLink size={12} /> {t("modal.testResult.openVideo")}
                  </button>
                  <button
                    onClick={() => api?.showItemInFolder(testResult.outputPath)}
                    className="cap-btn-secondary text-[11px]"
                  >
                    <FolderOpen size={12} /> {t("common.showInFolder")}
                  </button>
                </div>
              </>
            )}

            {testResult.status === "error" && (
              <>
                <p className="text-[11px] mb-3" style={{ color: "var(--rose)" }}>
                  {testResult.error || t("modal.testResult.unknownError")}
                </p>
                <div className="flex justify-end">
                  <button
                    onClick={() => setTestResult(null)}
                    className="cap-btn-secondary text-[11px]"
                  >
                    {t("common.close")}
                  </button>
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
              <button
                onClick={() => setSavePresetOpen(false)}
                className="cap-btn-secondary !p-1"
                title={t("common.close")}
              >
                <X size={14} />
              </button>
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
              <button
                onClick={() => setSavePresetOpen(false)}
                className="cap-btn-secondary text-[11px]"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={handleSavePresetSubmit}
                disabled={!savePresetName.trim()}
                className="cap-btn-primary text-[11px]"
              >
                <BookmarkPlus size={12} /> {t("common.save")}
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
