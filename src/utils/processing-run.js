import { createQueueResults, createArtifactResults } from "./processing-results.js";
import { tStatic } from "./format-message.js";
import { fileName } from "../../shared/file-name.js";

export function createProcessingRun(set, get) {
  let current = null;
  let disconnect = null;
  let scheduledFlush = null;
  let scheduledWithRaf = false;
  const pendingProgress = new Map();
  const retiredRunIds = new Set();

  function retire(runId) {
    if (!runId) return;
    retiredRunIds.add(runId);
    if (retiredRunIds.size > 64) retiredRunIds.delete(retiredRunIds.values().next().value);
  }

  function clearProgress() {
    pendingProgress.clear();
    if (scheduledFlush == null) return;
    if (scheduledWithRaf) cancelAnimationFrame(scheduledFlush);
    else clearTimeout(scheduledFlush);
    scheduledFlush = null;
  }

  function makeRun(runId = null, jobs = null, artifact = null, owner = null) {
    const state = get();
    if (!jobs && state.activeProcessingKind?.startsWith("editor:"))
      owner ??= state.activeProcessingKind;
    if (!jobs && !owner && state.activeProcessingKind) artifact = state.mediaExport;
    const paths = new Map(
      owner
        ? []
        : jobs
          ? jobs.map((job) => [job.id, job.input_path])
          : artifact
            ? [[artifact.jobId, null]]
            : state.queue.map((item, index) => [index, item.path]),
    );
    return {
      runId,
      started: Boolean(runId),
      owner,
      jobs: paths,
      target: owner ? null : artifact ? createArtifactResults(artifact) : createQueueResults(paths),
      results: new Map(),
      outcome: null,
    };
  }

  function isJob(run, index) {
    return Number.isInteger(index) && run.jobs.has(index) && run.target?.accepts(get(), index);
  }

  function flushProgress() {
    scheduledFlush = null;
    if (!current || current.outcome || pendingProgress.size === 0) return;
    const messages = [...pendingProgress.values()].filter((msg) => isJob(current, msg.index));
    pendingProgress.clear();
    set((state) => current.target.jobProgress(state, messages));
  }

  function notifyError(error) {
    const lang = get().language || "es";
    get().showToast({
      kind: "err",
      text: tStatic(
        "errors.processingFailed",
        { message: error || tStatic("errors.unknown", {}, lang) },
        lang,
      ),
    });
  }

  function finish(run, outcome) {
    if (run !== current || run.outcome) return;
    const jobFailure = [...run.results.values()].find((result) => result.kind !== "done");
    const reportedJobFailure = outcome.success && jobFailure;
    if (reportedJobFailure) outcome = { ...outcome, success: false, error: jobFailure.error };
    clearProgress();
    run.outcome = outcome;
    retire(run.runId);
    set((state) => ({
      ...run.target?.finish(state, outcome),
      isProcessing: false,
      activeProcessRunId: null,
      activeProcessingKind: null,
    }));
    if (
      run.target &&
      !outcome.success &&
      !outcome.cancelled &&
      !outcome.superseded &&
      !reportedJobFailure
    ) {
      outcome.notified = true;
      notifyError(outcome.error);
    }
  }

  function eventRun(msg) {
    if (!current && get().isProcessing) current = makeRun(get().activeProcessRunId);
    if (!current || current.outcome) return null;
    const runId = msg?.runId;
    if (runId) {
      if (retiredRunIds.has(runId)) return null;
      if (current.runId && current.runId !== runId) return null;
      if (!current.runId) {
        current.runId = runId;
        set({ activeProcessRunId: runId });
      }
    }
    current.started = true;
    return current;
  }

  function jobResult(kind, msg) {
    const run = eventRun(msg);
    const index = msg?.index;
    if (!run || !isJob(run, index)) return;
    const previous = run.results.get(index);
    if (previous?.kind === "done" || previous?.kind === "cancelled") return;
    if (kind === "cancelled" && previous) return;
    pendingProgress.delete(index);
    run.results.set(index, { ...msg, kind });
    set((state) => run.target.result(state, kind, msg, previous));
  }

  const WARNING_KEYS = {
    patch_skipped_timing: "errors.patchSkippedTiming",
    patch_skipped_budget: "errors.patchSkippedBudget",
    patch_skipped_too_large: "errors.patchSkippedTooLarge",
  };

  const handlers = {
    onRunStarted: (msg) => {
      const runId = msg?.runId;
      if (!runId || retiredRunIds.has(runId)) return;
      if (current?.runId === runId) return;
      if (!current || current.outcome || current.runId || msg.owner) {
        if (current && !current.outcome) {
          if (msg.owner && !current.started) current.restoreStart?.();
          current.outcome = { success: false, superseded: true };
          retire(current.runId);
        }
        current = makeRun(runId, null, null, msg.owner);
      } else {
        current.runId = runId;
        current.started = true;
      }
      clearProgress();
      set({
        activeProcessRunId: runId,
        activeProcessingKind: current.owner || current.target?.kind || null,
        isProcessing: true,
      });
    },
    onProgress: (msg) => {
      const run = eventRun(msg);
      if (run?.target) set((state) => run.target.progress(state, msg));
    },
    onJobProgress: (msg) => {
      const run = eventRun(msg);
      if (!run || !isJob(run, msg?.index) || run.results.has(msg.index)) return;
      pendingProgress.set(msg.index, msg);
      if (scheduledFlush != null) return;
      scheduledWithRaf =
        typeof requestAnimationFrame === "function" && typeof cancelAnimationFrame === "function";
      scheduledFlush = scheduledWithRaf
        ? requestAnimationFrame(flushProgress)
        : setTimeout(flushProgress, 50);
    },
    onComplete: (msg) => jobResult("done", msg),
    onJobError: (msg) => jobResult("error", msg),
    onJobCancelled: (msg) => jobResult("cancelled", msg),
    onSummary: (msg) => {
      const run = eventRun(msg);
      if (run?.target) set((state) => run.target.summary(state, msg));
    },
    onFinished: (msg) => {
      const run = eventRun(msg);
      if (!run) return;
      finish(run, {
        success: !msg?.cancelled && msg?.code === 0,
        cancelled: Boolean(msg?.cancelled),
        error: msg?.error,
      });
    },
    onRunWarning: (msg) => {
      const run = eventRun(msg);
      if (!run || run.outcome) return;
      const lang = get().language || "es";
      const key = msg?.code && WARNING_KEYS[msg.code];
      get().showToast({
        kind: "warn",
        text: (key ? tStatic(key, {}, lang) : msg?.message) || tStatic("errors.unknown", {}, lang),
      });
    },
    onError: (msg) => {
      const payload = typeof msg === "string" ? { error: msg } : msg;
      const run = eventRun(payload);
      if (run) finish(run, { success: false, error: payload?.error });
    },
  };

  function resultFor(run, prepared, videoIdx) {
    if (current !== run) return { ok: false, code: "superseded", superseded: true };
    const outcome = run.outcome;
    const job = run.results.get(videoIdx);
    const single = videoIdx != null;
    const ok = single && job ? job.kind === "done" : outcome.success;
    return {
      ok,
      ...(single ? { outputPath: job?.output || prepared.jobs[0].output_path } : {}),
      ...(!ok && (outcome.cancelled || job?.kind === "cancelled") ? { cancelled: true } : {}),
      ...(!ok && (job?.error || outcome.error) ? { error: job?.error || outcome.error } : {}),
      ...(outcome.notified ? { notified: true } : {}),
    };
  }

  async function confirmOverwrite(run, existingOutputs) {
    const state = get();
    const key = (path) => String(path).replace(/\//g, "\\").toLowerCase();
    const ownExports = new Set(
      [
        ...state.queue.map((item) => item.exportedOutputPath),
        state.mediaExport?.confirmedOutputPath,
      ]
        .filter(Boolean)
        .map(key),
    );
    if (!existingOutputs.every((path) => ownExports.has(key(path)))) {
      const confirmed = await state.requestConfirm({
        message: tStatic(
          "queue.confirmOverwrite",
          { count: String(existingOutputs.length), name: fileName(existingOutputs[0]) },
          state.language || "es",
        ),
        variant: "danger",
      });
      if (!confirmed) return false;
    }
    return run === current && !run.outcome;
  }

  function restoreStart(before, prepared) {
    set((state) => ({
      queue: state.queue.map((item, index) => {
        const previous = before.queue[index];
        const optimistic = prepared.startPatch.queue[index];
        if (!previous || item.path !== previous.path || !optimistic) return item;
        const restored = { ...item };
        for (const key of ["status", "progress", "error"]) {
          if (item[key] === optimistic[key]) restored[key] = previous[key];
        }
        return restored;
      }),
      ...(state.exportSignatures === prepared.startPatch.exportSignatures
        ? { exportSignatures: before.exportSignatures }
        : {}),
      progressDone: before.progressDone,
      progressTotal: before.progressTotal,
      jobProgress: before.jobProgress,
      batchSummary: before.batchSummary,
      ...(prepared.startPatch.mediaExport && state.mediaExport === prepared.startPatch.mediaExport
        ? { mediaExport: before.mediaExport }
        : {}),
    }));
  }

  async function start(api, prepared, videoIdx = null) {
    if (!api?.startProcessing) return { ok: false, code: "api_unavailable" };
    if (!prepared?.ok) return prepared;
    if (get().isProcessing) return { ok: false, code: "already_processing" };
    clearProgress();
    retire(current?.runId);
    const before = get();
    const run = makeRun(null, prepared.jobs, prepared.startPatch.mediaExport);
    run.restoreStart = () => restoreStart(before, prepared);
    current = run;
    set({
      ...prepared.startPatch,
      activeProcessRunId: null,
      activeProcessingKind: run.target.kind,
    });
    try {
      let response = await api.startProcessing(prepared.manifest);
      if (response?.code === "output_exists" && run === current && !run.outcome) {
        response = (await confirmOverwrite(run, response.existingOutputs || []))
          ? await api.startProcessing(prepared.manifest, { overwrite: true })
          : { success: false, cancelled: true };
      }
      if (run !== current) return resultFor(run, prepared, videoIdx);
      if (response?.code === "already_processing") {
        if (!run.started && !run.outcome) {
          restoreStart(before, prepared);
          set({
            activeProcessRunId: response.runId || before.activeProcessRunId,
            activeProcessingKind: response.owner || before.activeProcessingKind,
          });
          current = makeRun(
            response.runId || before.activeProcessRunId,
            null,
            null,
            response.owner,
          );
        }
        if (!run.outcome) set({ isProcessing: true });
        return { ok: false, code: response.code, error: response.error };
      }
      if (run.outcome) return resultFor(run, prepared, videoIdx);
      if (response?.runId && run.runId && response.runId !== run.runId) {
        return { ok: false, code: "superseded", superseded: true };
      }
      run.runId ??= response?.runId;
      if (!run.started && !response?.success && !response?.runId) {
        restoreStart(before, prepared);
      }
      finish(run, {
        success: Boolean(response?.success) && !response?.cancelled,
        cancelled: Boolean(response?.cancelled),
        error: response?.error,
      });
    } catch (err) {
      if (!run.started && run === current && !run.outcome) {
        restoreStart(before, prepared);
      }
      finish(run, { success: false, error: err?.message || String(err) });
    }
    return resultFor(run, prepared, videoIdx);
  }

  async function cancel(api) {
    if (!get().isProcessing) return { ok: true };
    if (!current || current.outcome) current = makeRun(get().activeProcessRunId);
    const run = current;
    try {
      const response = await api?.cancelProcessing?.();
      if (response?.success === false) {
        if (run === current && !run.outcome) notifyError(response.error);
        return { ok: false, error: response.error };
      }
      finish(run, { success: false, cancelled: true });
      return { ok: true };
    } catch (err) {
      const error = err?.message || String(err);
      if (run === current && !run.outcome) notifyError(error);
      return { ok: false, error };
    }
  }

  function connect(api) {
    disconnect?.();
    if (get().isProcessing && (!current || current.outcome)) {
      current = makeRun(get().activeProcessRunId);
    }
    const unsubs = Object.entries(handlers)
      .filter(([name]) => typeof api?.[name] === "function")
      .map(([name, handler]) => api[name](handler));
    const dispose = () => {
      for (const unsub of unsubs) unsub?.();
      if (disconnect === dispose) {
        clearProgress();
        disconnect = null;
      }
    };
    disconnect = dispose;
    return dispose;
  }

  return { start, cancel, connect };
}
