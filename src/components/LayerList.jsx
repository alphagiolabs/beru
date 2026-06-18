import { memo } from "react";
import { Trash2, Copy, ChevronUp, ChevronDown } from "lucide-react";
import { shallow } from "zustand/shallow";
import useEditorStore from "../stores/useEditorStore";
import { useT } from "../i18n/useT";

const labelKeys = {
  blur: "props.mode.blur",
  crop: "props.mode.crop",
  text: "props.mode.text",
  delogo: "props.mode.delogo",
};
const colors = {
  blur: "var(--accent)",
  crop: "var(--amber)",
  text: "var(--purple)",
  delogo: "var(--rose)",
};

const LayerRow = memo(function LayerRow({
  op,
  i,
  count,
  label,
  color,
  duplicateTitle,
  onMoveUp,
  onMoveDown,
  onDuplicate,
  onRemove,
}) {
  return (
    <div className="flex items-center gap-2 p-2 rounded" style={{ background: "var(--bg-elevated)" }}>
      <div
        className="w-2 h-2 rounded-full flex-shrink-0"
        style={{ background: color || "var(--text-dim)" }}
      />
      <span className="flex-1 text-[11px] font-medium" style={{ color: "var(--text-primary)" }}>
        {label}
        {op.mode === "text" && op.text
          ? ` "${op.text.slice(0, 20)}${op.text.length > 20 ? "…" : ""}"`
          : ""}
      </span>
      <div className="flex items-center gap-0.5">
        <button
          onClick={onMoveUp}
          disabled={i === 0}
          className="text-[10px] p-0.5 rounded hover:bg-white/10"
          style={{ color: "var(--text-dim)" }}
        >
          <ChevronUp size={12} />
        </button>
        <button
          onClick={onMoveDown}
          disabled={i === count - 1}
          className="text-[10px] p-0.5 rounded hover:bg-white/10"
          style={{ color: "var(--text-dim)" }}
        >
          <ChevronDown size={12} />
        </button>
        <button
          onClick={onDuplicate}
          className="text-[10px] p-0.5 rounded hover:bg-white/10"
          style={{ color: "var(--text-dim)" }}
          title={duplicateTitle}
        >
          <Copy size={12} />
        </button>
        <button
          onClick={onRemove}
          className="text-[10px] p-0.5 rounded hover:bg-red-500/20 hover:text-red-400"
          style={{ color: "var(--text-dim)" }}
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
});

export default function LayerList() {
  const { ops } = useEditorStore(
    (s) => ({
      selectedIdx: s.selectedIdx,
      ops:
        s.selectedIdx >= 0 && s.selectedIdx < s.queue.length
          ? s.queue[s.selectedIdx].operations
          : null,
    }),
    shallow,
  );
  const t = useT();
  const getState = useEditorStore.getState;
  if (!ops) return null;

  return (
    <div className="cap-section">
      <div className="cap-section-title">
        {t("props.layers")} ({ops.length})
      </div>
      {ops.length === 0 ? (
        <div className="text-[10px]" style={{ color: "var(--text-dim)" }}>
          {t("props.noLayers")}
        </div>
      ) : (
        <div className="space-y-1">
          {ops.map((op, i) => (
            <LayerRow
              key={op.id}
              op={op}
              i={i}
              count={ops.length}
              label={t(labelKeys[op.mode] || op.mode)}
              color={colors[op.mode]}
              duplicateTitle={t("props.actions.duplicate")}
              onMoveUp={() => getState().moveOperation(i, i - 1)}
              onMoveDown={() => getState().moveOperation(i, i + 1)}
              onDuplicate={() => getState().duplicateOperation(i)}
              onRemove={() => getState().removeOperation(i)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
