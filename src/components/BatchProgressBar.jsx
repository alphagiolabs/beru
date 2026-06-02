import useEditorStore from "../stores/useEditorStore";

export default function BatchProgressBar() {
  const { isProcessing, progressDone, progressTotal, queue } = useEditorStore();

  const done = progressDone || queue.filter((q) => q.status === "done").length;
  const total = progressTotal || queue.length;
  const anyDone = !isProcessing && done === total && done > 0;

  if (done === 0 && !isProcessing) return null;

  return (
    <div className="px-4 py-1.5 border-b flex-shrink-0" style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}>
      <div className="flex items-center gap-3">
        <span className="text-[10px] font-medium" style={{ color: "var(--text-dim)" }}>
          {isProcessing ? "Procesando" : "Completado"} {done}/{total}
        </span>
        <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--bg-elevated)" }}>
          <div className="h-full rounded-full transition-all duration-300"
            style={{ width: `${total > 0 ? (done / total) * 100 : 0}%`, background: anyDone ? "#22c55e" : "var(--accent)" }} />
        </div>
      </div>
    </div>
  );
}
