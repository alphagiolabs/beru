import { useEffect } from "react";

export default function useProcessing(api) {
  useEffect(() => {
    if (!api) return;
    const unsubs = [
      api.onProgress((msg) => {
        window.dispatchEvent(new CustomEvent("beru:progress", { detail: msg }));
      }),
      api.onJobProgress?.((msg) => {
        window.dispatchEvent(new CustomEvent("beru:jobProgress", { detail: msg }));
      }),
      api.onComplete((msg) => {
        window.dispatchEvent(new CustomEvent("beru:complete", { detail: msg }));
      }),
      api.onSummary((msg) => {
        window.dispatchEvent(new CustomEvent("beru:summary", { detail: msg }));
      }),
      api.onJobError((msg) => {
        window.dispatchEvent(new CustomEvent("beru:jobError", { detail: msg }));
      }),
      api.onFinished((msg) => {
        window.dispatchEvent(new CustomEvent("beru:finished", { detail: msg }));
      }),
      api.onError((msg) => {
        window.dispatchEvent(new CustomEvent("beru:error", { detail: msg }));
      }),
      api.onLog((msg) => {
        window.dispatchEvent(new CustomEvent("beru:log", { detail: msg }));
      }),
    ];
    return () => unsubs.forEach((u) => u?.());
  }, [api]);
}
