import { useState, useEffect, useRef } from "react";
import { Upload, Play, Square, FolderOutput, Undo2, Redo2, Keyboard, FlaskConical, X, FolderOpen, ExternalLink, Save, FolderInput, Library, ChevronDown, BookmarkPlus, Sun, Moon, Languages, History } from "lucide-react";
import { shallow } from "zustand/shallow";
import { useT, SUPPORTED_LANGUAGES } from "../i18n/useT";
import useEditorStore from "../stores/useEditorStore";

const api = window.api;

export default function Header() {
  const {
    isProcessing, batchSummary, exportFormat, encodeProfile, batchWorkers,
    outputDir, queue, selectedIdx, presets, theme, language, recent,
  } = useEditorStore(
    (s) => ({
      isProcessing: s.isProcessing,
      batchSummary: s.batchSummary,
      exportFormat: s.exportFormat,
      encodeProfile: s.encodeProfile,
      batchWorkers: s.batchWorkers,
      outputDir: s.outputDir,
      queue: s.queue,
      selectedIdx: s.selectedIdx,
      presets: s.presets,
      theme: s.theme,
      language: s.language,
      recent: s.recent,
    }),
    shallow,
  );
  const showToast = useEditorStore((s) => s.showToast);
  const undoStack = useEditorStore((s) => s.undoStack);
  const redoStack = useEditorStore((s) => s.redoStack);
  const t = useT();
  const get = useEditorStore.getState;
  const [testResult, setTestResult] = useState(null);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [savePresetOpen, setSavePresetOpen] = useState(false);
  const [savePresetName, setSavePresetName] = useState("");
  const [langOpen, setLangOpen] = useState(false);
  const [recentOpen, setRecentOpen] = useState(false);
  const presetsRef = useRef(null);
  const savePresetInputRef = useRef(null);
  const langRef = useRef(null);
  const recentRef = useRef(null);

  useEffect(() => {
    if (!presetsOpen) return;
    const onDown = (e) => {
      if (presetsRef.current && !presetsRef.current.contains(e.target)) setPresetsOpen(false);
    };
    const onKey = (e) => { if (e.key === "Escape") setPresetsOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [presetsOpen]);

  useEffect(() => {
    if (!langOpen) return;
    const onDown = (e) => {
      if (langRef.current && !langRef.current.contains(e.target)) setLangOpen(false);
    };
    const onKey = (e) => { if (e.key === "Escape") setLangOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [langOpen]);

  useEffect(() => {
    if (!recentOpen) return;
    const onDown = (e) => {
      if (recentRef.current && !recentRef.current.contains(e.target)) setRecentOpen(false);
    };
    const onKey = (e) => { if (e.key === "Escape") setRecentOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [recentOpen]);

  const flashToast = (kind, text) => showToast({ kind, text });

  const handleTogglePresets = async () => {
    if (!presetsOpen && presets.length === 0) {
      await get().loadPresets();
    }
    setPresetsOpen((v) => !v);
  };

  const handleApplyPreset = (preset) => {
    setPresetsOpen(false);
    if (queue.length > 0 && !confirm(t("header.confirmApplyPreset", { name: preset.name }))) return;
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
    if (queue.length > 0 && !confirm(t("header.confirmLoadQueue"))) return;
    const res = await get().loadProject();
    if (res.canceled) return;
    if (res.ok) flashToast("ok", t("header.loadedFrom", { name: res.filePath.split(/[\\/]/).pop() }));
    else flashToast("err", res.error || t("header.couldNotLoad"));
  };

  const handleOpenRecent = async (entry) => {
    setRecentOpen(false);
    if (!entry?.path) return;
    if (queue.length > 0 && !confirm(t("header.confirmLoadRecent"))) return;
    const res = await get().loadProjectFromPath(entry.path);
    if (res.ok) flashToast("ok", t("header.loadedFrom", { name: entry.name || entry.path.split(/[\\/]/).pop() }));
    else if (res.error && /no encontrad|not found|missing/i.test(res.error)) flashToast("err", t("header.recentMissing"));
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
      } else {
        console.log("[beru] Output directory selection canceled or returned null");
      }
    } catch (err) {
      console.error("[beru] Error selecting output directory:", err);
    }
  };

  const handleAddVideos = async () => {
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
    if (!api) return;
    get().setBatchSummary(null);
    const queueForProcessing = queue.some((q) => !q.width || !q.height)
      ? await get().refreshMissingVideoInfo(api)
      : queue;
    const missingDims = queueForProcessing.filter((q) => !q.width || !q.height);
    if (missingDims.length > 0) {
      const names = missingDims.slice(0, 3).map((q) => q.filename).join(", ");
      const more = missingDims.length > 3 ? ` (+${missingDims.length - 3})` : "";
      if (!confirm(t("header.missingDimensions", {
        count: missingDims.length,
        names,
        more,
      }))) return;
    }
    const jobs = queueForProcessing.map((q, i) => get()._buildJobFor(q, i)).filter(Boolean);
    get().setProcessing(true);
    useEditorStore.setState({ progressTotal: jobs.length, progressDone: 0 });

    api.startProcessing(jobs).then((result) => {
      if (!result.success) {
        // Runtime failures are toasted via useProcessing → onError; only pre-spawn errors here.
        if (result.error && result.code == null) {
          showToast({
            kind: "err",
            text: t("errors.processStartFailed", {
              message: result.error,
            }),
          });
        }
        get().setProcessing(false);
      }
    }).catch((e) => {
      showToast({
        kind: "err",
        text: t("errors.processStartFailed", { message: e.message }),
      });
      get().setProcessing(false);
    });
  };

  const handleTestCurrent = async () => {
    if (!api || selectedIdx < 0) return;
    setTestResult({ status: "running" });
    const res = await get().processSingle(selectedIdx);
    setTestResult({ status: res.ok ? "ok" : "error", outputPath: res.outputPath, error: res.error });
  };

  const handleCancel = async () => {
    await api?.cancelProcessing();
    get().setProcessing(false);
  };

  const canTest = !isProcessing && selectedIdx >= 0 && selectedIdx < queue.length;

  return (
    <header className="flex items-center justify-between px-4 py-2 border-b flex-shrink-0" style={{ background: "var(--bg-elevated)", borderColor: "var(--border)" }}>
      <div className="flex items-center gap-3">
        <svg viewBox="0 0 300 400" width="22" height="28" aria-label="Beru"><path fill="currentColor" fillRule="evenodd" d="M0 0L140 0C260 0 260 195 140 195L165 195C295 195 295 400 165 400L0 400ZM60 50L120 50C195 50 195 145 120 145L60 145ZM60 240L140 240C225 240 225 350 140 350L60 350ZM100 168L195 195L100 222Z"/></svg>
        <span className="text-sm font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>BERU</span>
        <span className="text-[10px] tracking-wider uppercase" style={{ color: "var(--text-dim)" }}>Editor de Video Masivo</span>
      </div>

      <div className="flex items-center gap-2">
        <button onClick={handleAddVideos} disabled={isProcessing} className="cap-btn-secondary text-[11px] whitespace-nowrap">
          <Upload size={14} /> Importar
        </button>

        <button onClick={handleSelectOutput} disabled={isProcessing} className="cap-btn-secondary text-[11px] whitespace-nowrap"
          title={outputDir ? `Salida: ${outputDir}` : t("header.selectOutput")}>
          <FolderOutput size={14} /> {outputDir ? "Salida ✓" : t("header.selectOutput")}
        </button>

        <select value={exportFormat} onChange={(e) => get().setExportFormat(e.target.value)}
          className="cap-input w-[72px] !py-1 text-[11px]" disabled={isProcessing}>
          <option value="mp4">MP4</option>
          <option value="mov">MOV</option>
          <option value="avi">AVI</option>
        </select>

        <select
          value={encodeProfile}
          onChange={(e) => get().setEncodeProfile(e.target.value)}
          className="cap-input w-[108px] !py-1 text-[11px]"
          disabled={isProcessing}
          title={t("header.encodeProfileHint")}
        >
          <option value="fast">{t("header.encodeFast")}</option>
          <option value="balanced">{t("header.encodeBalanced")}</option>
          <option value="quality">{t("header.encodeQuality")}</option>
        </select>

        <select
          value={String(batchWorkers)}
          onChange={(e) => get().setBatchWorkers(e.target.value)}
          className="cap-input w-[88px] !py-1 text-[11px]"
          disabled={isProcessing}
          title={t("header.batchWorkersHint")}
        >
          <option value="0">{t("header.workersAuto")}</option>
          <option value="1">1</option>
          <option value="2">2</option>
          <option value="3">3</option>
          <option value="4">4</option>
          <option value="6">6</option>
        </select>

        <button
          onClick={handleTestCurrent}
          disabled={!canTest}
          className="cap-btn-secondary text-[11px] whitespace-nowrap"
          title={canTest ? "Renderiza sólo el video seleccionado" : "Selecciona un video de la lista"}
        >
          <FlaskConical size={14} /> {t("header.testRender")}
        </button>

        {!isProcessing ? (
          <button onClick={handleProcessAll} disabled={queue.length === 0} className="cap-btn-primary whitespace-nowrap">
            <Play size={14} /> {t("header.processAll")}
          </button>
        ) : (
          <button onClick={handleCancel} className="cap-btn-danger whitespace-nowrap">
            <Square size={14} /> {t("header.cancel")}
          </button>
        )}

        <div className="w-px h-5 mx-1" style={{ background: "var(--border)" }} />

        <button onClick={get().undo} disabled={undoStack.length === 0} className="cap-btn-secondary !p-1.5" title={`${t("header.undo")} (Ctrl+Z)`}>
          <Undo2 size={14} />
        </button>
        <button onClick={get().redo} disabled={redoStack.length === 0} className="cap-btn-secondary !p-1.5" title={`${t("header.redo")} (Ctrl+Y)`}>
          <Redo2 size={14} />
        </button>
        <div className="relative" ref={presetsRef}>
          <button onClick={handleTogglePresets} className="cap-btn-secondary !p-1.5" title={t("header.presetsLibrary")}>
            <Library size={14} /><ChevronDown size={10} />
          </button>
          {presetsOpen && (
            <div className="absolute right-0 top-full mt-1 z-40 rounded-md shadow-xl py-1 w-[280px] max-h-[420px] overflow-y-auto"
              style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
              <div className="px-3 py-1.5 text-[9px] font-semibold tracking-wider uppercase" style={{ color: "var(--text-dim)" }}>
                Presets
              </div>
              {presets.length === 0 ? (
                <div className="px-3 py-3 text-[11px]" style={{ color: "var(--text-dim)" }}>
                  {t("header.noPresets")}
                </div>
              ) : presets.map((p, i) => {
                const prev = i > 0 && presets[i - 1].source !== p.source;
                return (
                  <div key={`${p.source}-${p.filename}`}>
                    {prev && <div className="my-1 border-t" style={{ borderColor: "var(--border)" }} />}
                    <button onClick={() => handleApplyPreset(p)}
                      className="w-full text-left px-3 py-2 hover:opacity-80"
                      style={{ background: "transparent" }}>
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-[11px] font-medium" style={{ color: "var(--text-primary)" }}>{p.name}</span>
                        <span className="text-[8px] font-semibold tracking-wider uppercase px-1 py-0.5 rounded"
                          style={{
                            color: p.source === "bundled" ? "var(--accent)" : "#22c55e",
                            background: p.source === "bundled" ? "rgba(0,240,234,0.10)" : "rgba(34,197,94,0.10)",
                          }}>
                          {p.source === "bundled" ? "Incluido" : "Personalizado"}
                        </span>
                      </div>
                      {p.description && (
                        <div className="text-[10px] leading-snug" style={{ color: "var(--text-dim)" }}>{p.description}</div>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <button onClick={handleLoadProject} disabled={isProcessing} className="cap-btn-secondary !p-1.5" title={t("header.loadProject")}>
          <FolderInput size={14} />
        </button>
        <div className="relative" ref={recentRef}>
          <button onClick={() => setRecentOpen((v) => !v)} className="cap-btn-secondary !p-1.5" title={t("header.recent")}>
            <History size={14} /><ChevronDown size={10} />
          </button>
          {recentOpen && (
            <div className="absolute right-0 top-full mt-1 rounded shadow-lg z-50 w-[280px]"
              style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
              {recent.length === 0 ? (
                <div className="px-3 py-2 text-[11px]" style={{ color: "var(--text-dim)" }}>
                  {t("header.noRecents")}
                </div>
              ) : (
                <div className="py-1 max-h-[280px] overflow-y-auto">
                  {recent.map((r) => (
                    <div key={r.path}
                      onClick={() => handleOpenRecent(r)}
                      className="group flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:opacity-80"
                      style={{ opacity: r.exists === false ? 0.4 : 1 }}>
                      <History size={11} style={{ color: "var(--text-dim)" }} className="flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] font-medium truncate" style={{ color: "var(--text-primary)" }}>
                          {r.name || r.path.split(/[\\/]/).pop()}
                        </div>
                        <div className="text-[9px] truncate" style={{ color: "var(--text-dim)" }} title={r.path}>
                          {r.path}
                        </div>
                      </div>
                      <button onClick={(e) => handleRemoveRecent(e, r)}
                        className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-white/10 flex-shrink-0"
                        style={{ color: "var(--text-dim)" }}
                        title={t("common.remove")}>
                        <X size={11} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <button onClick={handleSaveProject} className="cap-btn-secondary !p-1.5" title={t("header.saveProject")}>
          <Save size={14} />
        </button>
        <button onClick={openSavePreset} className="cap-btn-secondary !p-1.5" title={t("header.savePreset")}>
          <BookmarkPlus size={14} />
        </button>
        <button onClick={() => get().toggleTheme()} className="cap-btn-secondary !p-1.5" title={t("header.theme")}>
          {theme === "light" ? <Moon size={14} /> : <Sun size={14} />}
        </button>
        <div className="relative" ref={langRef}>
          <button onClick={() => setLangOpen((v) => !v)} className="cap-btn-secondary !p-1.5 !text-[10px] font-semibold" title={t("header.language")}>
            <Languages size={14} />{language.toUpperCase()}<ChevronDown size={10} />
          </button>
          {langOpen && (
            <div className="absolute right-0 top-full mt-1 rounded shadow-lg z-50 min-w-[120px]"
              style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}>
              {SUPPORTED_LANGUAGES.map((lng) => (
                <button key={lng.code}
                  onClick={() => { get().setLanguage(lng.code); setLangOpen(false); }}
                  className="block w-full text-left px-3 py-1.5 text-[11px] hover:opacity-80"
                  style={{ color: lng.code === language ? "var(--accent)" : "var(--text-secondary)", fontWeight: lng.code === language ? 600 : 400 }}>
                  {lng.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <button onClick={() => get().setShowShortcuts(true)} className="cap-btn-secondary !p-1.5" title={t("header.shortcuts")}>
          <Keyboard size={14} />
        </button>

        {batchSummary && (
          <span className="text-[11px] ml-2" style={{ color: "var(--text-secondary)" }}>
            {batchSummary.succeeded}/{batchSummary.total} ok
            {batchSummary.failed > 0 && <span style={{ color: "var(--rose)" }}> · {batchSummary.failed} err</span>}
          </span>
        )}
      </div>

      {testResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }}
          onClick={() => testResult.status !== "running" && setTestResult(null)}>
          <div className="rounded-lg shadow-2xl p-5 w-[420px]" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                {testResult.status === "running" && t("modal.testResult.running")}
                {testResult.status === "ok" && t("modal.testResult.ok")}
                {testResult.status === "error" && t("modal.testResult.error")}
              </h3>
              {testResult.status !== "running" && (
                <button onClick={() => setTestResult(null)} className="cap-btn-secondary !p-1" title="Cerrar">
                  <X size={14} />
                </button>
              )}
            </div>

            {testResult.status === "running" && (
              <div className="flex items-center gap-2 text-[12px]" style={{ color: "var(--text-secondary)" }}>
                <div className="w-3 h-3 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: "var(--accent)", borderTopColor: "transparent" }} />
                {t("modal.testResult.processingWith")}
              </div>
            )}

            {testResult.status === "ok" && (
              <>
                <p className="text-[11px] mb-3 break-all" style={{ color: "var(--text-dim)" }}>{testResult.outputPath}</p>
                <div className="flex gap-2 justify-end">
                  <button onClick={() => api?.openPath(testResult.outputPath)} className="cap-btn-primary text-[11px]">
                    <ExternalLink size={12} /> {t("modal.testResult.openVideo")}
                  </button>
                  <button onClick={() => api?.showItemInFolder(testResult.outputPath)} className="cap-btn-secondary text-[11px]">
                    <FolderOpen size={12} /> {t("common.showInFolder")}
                  </button>
                </div>
              </>
            )}

            {testResult.status === "error" && (
              <>
                <p className="text-[11px] mb-3" style={{ color: "var(--rose)" }}>{testResult.error || t("modal.testResult.unknownError")}</p>
                <div className="flex justify-end">
                  <button onClick={() => setTestResult(null)} className="cap-btn-secondary text-[11px]">{t("common.close")}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {savePresetOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }}
          onClick={() => setSavePresetOpen(false)}>
          <div className="rounded-lg shadow-2xl p-5 w-[380px]" style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                {t("modal.savePreset.title")}
              </h3>
              <button onClick={() => setSavePresetOpen(false)} className="cap-btn-secondary !p-1" title={t("common.close")}>
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
              onKeyDown={(e) => { if (e.key === "Enter") handleSavePresetSubmit(); if (e.key === "Escape") setSavePresetOpen(false); }}
              placeholder={t("modal.savePreset.placeholder")}
              className="w-full px-2 py-1.5 rounded text-[12px] mb-3 outline-none"
              style={{ background: "var(--bg-app)", color: "var(--text-primary)", border: "1px solid var(--border)" }}
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setSavePresetOpen(false)} className="cap-btn-secondary text-[11px]">{t("common.cancel")}</button>
              <button onClick={handleSavePresetSubmit} disabled={!savePresetName.trim()} className="cap-btn-primary text-[11px]">
                <BookmarkPlus size={12} /> {t("common.save")}
              </button>
            </div>
          </div>
        </div>
      )}

    </header>
  );
}
