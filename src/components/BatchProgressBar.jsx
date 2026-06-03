import { shallow } from "zustand/shallow";
import useEditorStore from "../stores/useEditorStore";
import { useT } from "../i18n/useT";
import { getBatchProgress } from "../utils/batch-progress";

export default function BatchProgressBar() {
  const { isProcessing, progressDone, progressTotal, queue } = useEditorStore(
    (s) => ({
      isProcessing: s.isProcessing,
      progressDone: s.progressDone,
      progressTotal: s.progressTotal,
      queue: s.queue,
    }),
    shallow,
  );
  const t = useT();

  const { completed, total, percent } = getBatchProgress({
    queue,
    progressDone,
    progressTotal,
  });
  const anyDone = !isProcessing && completed === total && completed > 0;

  if (completed === 0 && percent === 0 && !isProcessing) return null;

  return (
    <div
      className="px-4 py-1.5 border-b flex-shrink-0"
      style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}
    >
      <div className="flex items-center gap-3">
        <span className="text-[10px] font-medium" style={{ color: "var(--text-dim)" }}>
          {isProcessing ? t("batchProgress.processing") : t("batchProgress.done")} {completed}/
          {total}
        </span>
        <div
          className="flex-1 h-1.5 rounded-full overflow-hidden"
          style={{ background: "var(--bg-elevated)" }}
        >
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{ width: `${percent}%`, background: anyDone ? "#22c55e" : "var(--accent)" }}
          />
        </div>
      </div>
    </div>
  );
}
