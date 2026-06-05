import { shallow } from "zustand/shallow";
import { Download } from "lucide-react";
import useEditorStore from "../stores/useEditorStore";
import { useT } from "../i18n/useT";
import { getBatchProgress } from "../utils/batch-progress";

export default function BatchProgressBar() {
  const { isProcessing, progressDone, progressTotal, queue, logLines } = useEditorStore(
    (s) => ({
      isProcessing: s.isProcessing,
      progressDone: s.progressDone,
      progressTotal: s.progressTotal,
      queue: s.queue,
      logLines: s.logLines,
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
  const handleExportLogs = async () => {
    const state = useEditorStore.getState();
    const res = await window.api?.exportProcessingLogs?.(state.exportProcessingLogsText());
    if (res?.success) {
      state.showToast({ kind: "ok", text: "Logs exportados" });
    } else if (!res?.canceled) {
      state.showToast({ kind: "err", text: "No se pudieron exportar los logs" });
    }
  };

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
        {logLines.length > 0 && (
          <button
            type="button"
            onClick={handleExportLogs}
            className="cap-btn-secondary !px-2 !py-1 !text-[10px]"
            title="Exportar logs"
          >
            <Download size={12} />
          </button>
        )}
      </div>
    </div>
  );
}
