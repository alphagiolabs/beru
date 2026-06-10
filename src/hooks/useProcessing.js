import { useEffect } from "react";
import useEditorStore from "../stores/useEditorStore";
import { tStatic } from "../utils/format-message";

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
      bind(api.onFinished, () => {
        cancelJobProgressFlush();
        flushJobProgress();
        const state = useEditorStore.getState();
        state.finalizeActiveExecution();
        state.setProcessing(false);
      }),
      bind(api.onError, (msg) => {
        pendingJobProgress.clear();
        cancelJobProgressFlush();
        const state = useEditorStore.getState();
        state.setProcessing(false);
        console.error("[beru] Processing error:", msg);
        state.showToast({ kind: "err", text: processingErrorText(msg) });
      }),
      bind(api.onLog, (msg) => {
        useEditorStore.getState().appendLog(msg);
      }),
    ].filter(Boolean);
    return () => {
      pendingJobProgress.clear();
      cancelJobProgressFlush();
      unsubs.forEach((u) => u?.());
    };
  }, [api]);
}
