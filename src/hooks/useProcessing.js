import { useEffect } from "react";
import useEditorStore from "../stores/useEditorStore";
import { tStatic } from "../utils/format-message";
import { PERF_FLAGS } from "../utils/perf-flags.js";

function processingErrorText(detail) {
  const lang = useEditorStore.getState().language || "es";
  const message = typeof detail === "string" ? detail : detail?.message || detail?.error || "";
  return tStatic(
    "errors.processingFailed",
    {
      message: message || tStatic("errors.unknown", {}, lang),
    },
    lang,
  );
}

function bind(apiFn, handler) {
  if (typeof apiFn !== "function") return null;
  return apiFn(handler);
}

export default function useProcessing(api) {
  useEffect(() => {
    if (!api) return;
    const pendingJobProgress = new Map();
    let scheduledFlush = null;
    let scheduledWithRaf = false;

    const flushJobProgress = () => {
      scheduledFlush = null;
      if (pendingJobProgress.size === 0) return;
      const messages = Array.from(pendingJobProgress.values());
      pendingJobProgress.clear();
      useEditorStore.getState().updateJobProgressBatch(messages);
    };

    const scheduleJobProgressFlush = () => {
      if (scheduledFlush != null) return;
      if (typeof requestAnimationFrame === "function") {
        scheduledWithRaf = true;
        scheduledFlush = requestAnimationFrame(flushJobProgress);
      } else {
        scheduledWithRaf = false;
        scheduledFlush = setTimeout(flushJobProgress, 50);
      }
    };

    const cancelJobProgressFlush = () => {
      if (scheduledFlush == null) return;
      if (scheduledWithRaf && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(scheduledFlush);
      } else {
        clearTimeout(scheduledFlush);
      }
      scheduledFlush = null;
    };

    const clearPendingJob = (index) => {
      if (Number.isInteger(index)) pendingJobProgress.delete(index);
    };

    // Log batching: coalesce rapid onLog calls into a single store update every
    // 50ms (flag-gated). Legacy path appends one line at a time.
    const logBatchEnabled = PERF_FLAGS.logBatch;
    const pendingLogs = [];
    let logFlushTimer = null;
    const flushLogs = () => {
      logFlushTimer = null;
      if (pendingLogs.length === 0) return;
      const state = useEditorStore.getState();
      // Prefer a batched append when available; otherwise fall back per-line.
      if (typeof state.appendLogBatch === "function") {
        state.appendLogBatch(pendingLogs.splice(0, pendingLogs.length));
      } else {
        for (const line of pendingLogs.splice(0, pendingLogs.length)) {
          state.appendLog(line);
        }
      }
    };
    const scheduleLogFlush = () => {
      if (logFlushTimer != null) return;
      logFlushTimer = setTimeout(flushLogs, 50);
    };

    const unsubs = [
      bind(api.onProgress, (msg) => {
        useEditorStore.getState().updateProcessingProgress(msg);
      }),
      bind(api.onJobProgress, (msg) => {
        if (!Number.isInteger(msg?.index)) return;
        pendingJobProgress.set(msg.index, msg);
        scheduleJobProgressFlush();
      }),
      bind(api.onComplete, (msg) => {
        clearPendingJob(msg?.index);
        useEditorStore.getState().markJobDone(msg);
      }),
      bind(api.onSummary, (msg) => {
        useEditorStore.getState().setBatchSummary(msg);
      }),
      bind(api.onJobError, (msg) => {
        clearPendingJob(msg?.index);
        useEditorStore.getState().markJobError(msg);
      }),
      bind(api.onFinished, (msg) => {
        cancelJobProgressFlush();
        flushJobProgress();
        const state = useEditorStore.getState();
        state.finalizeActiveExecution();
        if (msg?.cancelled) {
          state.abortActiveProcessing();
        } else {
          state.setProcessing(false);
        }
      }),
      bind(api.onError, (msg) => {
        pendingJobProgress.clear();
        cancelJobProgressFlush();
        const state = useEditorStore.getState();
        // Global process:error has no process:finished — reset busy rows so the
        // queue does not stay stuck in "processing".
        state.abortActiveProcessing();
        state.finalizeActiveExecution();
        console.error("[beru] Processing error:", msg);
        state.showToast({ kind: "err", text: processingErrorText(msg) });
      }),
      bind(api.onLog, (msg) => {
        if (logBatchEnabled) {
          pendingLogs.push(msg);
          scheduleLogFlush();
        } else {
          useEditorStore.getState().appendLog(msg);
        }
      }),
    ].filter(Boolean);
    return () => {
      pendingJobProgress.clear();
      cancelJobProgressFlush();
      if (logFlushTimer != null) clearTimeout(logFlushTimer);
      flushLogs();
      unsubs.forEach((u) => u?.());
    };
  }, [api]);
}
