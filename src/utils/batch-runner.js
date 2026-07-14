import { hasVideoDimensions, listVideosMissingBatchText } from "./batch-process.js";
import { createJobManifest } from "./job-manifest.js";
import {
  abortProcessingQueue,
  createBatchStartPatch,
  createSingleStartPatch,
} from "./export-pipeline.js";

/**
 * Validate queue readiness before starting a batch export.
 * @returns {{ ok: true } | { ok: false, code: string, details?: object }}
 */
export function validateBatchReady({ queue, templateRegions = [], getCellText }) {
  const list = Array.isArray(queue) ? queue : [];
  const missingDims = list.filter((q) => !hasVideoDimensions(q));
  if (missingDims.length > 0) {
    return {
      ok: false,
      code: "missing_dimensions",
      details: { missing: missingDims, count: missingDims.length },
    };
  }

  if (templateRegions?.length > 0 && typeof getCellText === "function") {
    const missingText = listVideosMissingBatchText(list, templateRegions, getCellText);
    if (missingText.length > 0) {
      return {
        ok: false,
        code: "missing_batch_text",
        details: { missing: missingText, count: missingText.length },
      };
    }
  }

  return { ok: true };
}

/**
 * Start a batch processing run.
 * @param {{ api: object, jobs: Array, queue: Array, hooks: object }} args
 */
function isAlreadyRunningFailure(result) {
  if (!result || typeof result !== "object") return false;
  if (result.code === "already_processing") return true;
  const err = result.error || "";
  return typeof err === "string" && /proceso en ejecución/i.test(err);
}

export async function runBatch({ api, jobs, queue, hooks }) {
  if (!api?.startProcessing) {
    return { ok: false, code: "api_unavailable" };
  }
  if (!Array.isArray(jobs) || jobs.length === 0) {
    return { ok: false, code: "no_jobs" };
  }

  hooks.startExecutionRun?.({ kind: "batch", jobCount: jobs.length });
  hooks.applyPatch?.(createBatchStartPatch({ queue, jobCount: jobs.length }));

  const clearProcessing = () => {
    // Prefer setProcessing so execution-history persistence still runs on stop.
    if (typeof hooks.setProcessing === "function") hooks.setProcessing(false);
    else hooks.applyPatch?.({ isProcessing: false });
  };

  const failStart = (error, code = null) => {
    clearProcessing();
    hooks.finalizeActiveExecution?.(null);
    return { ok: false, error, ...(code != null ? { code } : {}) };
  };

  try {
    const result = await api.startProcessing(createJobManifest(jobs));
    if (!result?.success) {
      // Another run owns the lock — do not tear down its UI/history.
      if (isAlreadyRunningFailure(result)) {
        return {
          ok: false,
          error: result.error || "Ya hay un proceso en ejecución",
          code: result.code ?? "already_processing",
        };
      }
      return failStart(result?.error || "startProcessing failed", result?.code ?? null);
    }
    return { ok: true };
  } catch (e) {
    return failStart(e?.message || String(e));
  }
}

/**
 * Run a single-video processing job (test current / sidebar process).
 */
export async function runSingle({ api, job, videoIdx, queue, isProcessing = false, hooks }) {
  if (!api?.startProcessing) {
    return { ok: false, code: "api_unavailable", error: "API de procesamiento no disponible" };
  }
  if (isProcessing) {
    return { ok: false, code: "already_processing", error: "Ya hay un proceso en ejecución" };
  }
  if (!job) {
    return { ok: false, code: "no_job", error: "No se pudo construir el job" };
  }
  if (!Number.isInteger(videoIdx) || videoIdx < 0 || videoIdx >= (queue?.length || 0)) {
    return { ok: false, code: "invalid_video", error: "Video inválido" };
  }

  hooks.startExecutionRun?.({ kind: "single", jobCount: 1 });
  hooks.applyPatch?.(createSingleStartPatch({ queue, videoIdx }));

  let startError = null;
  let ok = false;
  try {
    const result = await api.startProcessing(createJobManifest([job]));
    const liveItem = hooks.getQueue?.()?.[videoIdx];
    const itemError = liveItem?.error;
    if (!result?.success) {
      startError = result?.error || itemError || "startProcessing failed";
      ok = false;
    } else if (result?.cancelled) {
      startError = result?.error || "Cancelled";
      ok = false;
    } else if (liveItem?.status === "error") {
      // Process exit 0 but job failed via NDJSON — do not report success.
      startError = itemError || "Procesamiento fallido";
      ok = false;
    } else {
      // success + non-error row (done, or still processing/idle if IPC mock
      // did not markJobDone — trust process success unless row is error).
      ok = true;
    }
    return {
      ok,
      outputPath: job.output_path,
      error: startError || undefined,
    };
  } catch (e) {
    startError = e?.message || String(e);
    ok = false;
    return { ok: false, error: startError };
  } finally {
    const currentQueue = hooks.getQueue?.() ?? queue;
    const summary = hooks.summarizeQueue?.(currentQueue);
    hooks.finalizeActiveExecution?.(summary);
    if (startError) {
      const nextQueue = [...currentQueue];
      if (videoIdx >= 0 && videoIdx < nextQueue.length) {
        const row = nextQueue[videoIdx];
        // Prefer leaving an already-marked error/done row alone when message matches.
        if (row?.status !== "error") {
          nextQueue[videoIdx] = {
            ...row,
            status: "error",
            progress: 0,
            error: startError,
          };
        }
      }
      hooks.applyPatch?.({ queue: nextQueue, isProcessing: false, jobProgress: {} });
    } else {
      hooks.applyPatch?.({ isProcessing: false });
    }
  }
}

/**
 * Cancel in-flight processing and reset mid-batch queue rows.
 */
export async function cancelBatch({ api, hooks }) {
  if (api?.cancelProcessing) {
    await api.cancelProcessing();
  }
  // Prefer the store abort helper when provided (same path as useProcessing).
  if (typeof hooks.abortActiveProcessing === "function") {
    hooks.abortActiveProcessing();
    return { ok: true };
  }
  const queue = hooks.getQueue?.() ?? [];
  const { queue: nextQueue, queueChanged } = abortProcessingQueue(queue);
  hooks.applyPatch?.({
    ...(queueChanged ? { queue: nextQueue } : {}),
    jobProgress: {},
    isProcessing: false,
  });
  return { ok: true };
}
