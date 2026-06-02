import { useEffect } from "react";
import useEditorStore from "../stores/useEditorStore";
import { tStatic } from "../utils/format-message";

function processingErrorText(detail) {
  const lang = useEditorStore.getState().language || "es";
  const message = typeof detail === "string"
    ? detail
    : (detail?.message || detail?.error || "");
  return tStatic("errors.processingFailed", {
    message: message || tStatic("errors.unknown", {}, lang),
  }, lang);
}

function bind(apiFn, handler) {
  if (typeof apiFn !== "function") return null;
  return apiFn(handler);
}

export default function useProcessing(api) {
  useEffect(() => {
    if (!api) return;
    const unsubs = [
      bind(api.onProgress, (msg) => {
        useEditorStore.getState().updateProcessingProgress(msg);
      }),
      bind(api.onJobProgress, (msg) => {
        useEditorStore.getState().updateJobProgress(msg);
      }),
      bind(api.onComplete, (msg) => {
        useEditorStore.getState().markJobDone(msg);
      }),
      bind(api.onSummary, (msg) => {
        useEditorStore.getState().setBatchSummary(msg);
      }),
      bind(api.onJobError, (msg) => {
        useEditorStore.getState().markJobError(msg);
      }),
      bind(api.onFinished, () => {
        useEditorStore.getState().setProcessing(false);
      }),
      bind(api.onError, (msg) => {
        const state = useEditorStore.getState();
        state.setProcessing(false);
        console.error("[beru] Processing error:", msg);
        state.showToast({ kind: "err", text: processingErrorText(msg) });
      }),
      bind(api.onLog, (msg) => {
        useEditorStore.getState().appendLog(msg);
      }),
    ].filter(Boolean);
    return () => unsubs.forEach((u) => u?.());
  }, [api]);
}