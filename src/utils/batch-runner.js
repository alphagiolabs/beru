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

  try {
    const result = await api.startProcessing(createJobManifest(jobs));
    if (!result?.success) {
      clearProcessing();
      return {
        ok: false,
        error: result?.error || "startProcessing failed",
        code: result?.code ?? null,
      };
    }
    return { ok: true };
  } catch (e) {
    clearProcessing();
    return { ok: false, error: e?.message || String(e) };
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

  try {
    const result = await api.startProcessing(createJobManifest([job]));
    const itemError = hooks.getQueue?.()?.[videoIdx]?.error;
    return {
      ok: !!result?.success,
      outputPath: job.output_path,
      error: result?.error || itemError || undefined,
    };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  } finally {
    const currentQueue = hooks.getQueue?.() ?? queue;
    const summary = hooks.summarizeQueue?.(currentQueue);
    hooks.finalizeActiveExecution?.(summary);
    hooks.applyPatch?.({ isProcessing: false });
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
