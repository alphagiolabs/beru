import { memo, useCallback } from "react";
import { Trash2, Copy, ChevronUp, ChevronDown } from "lucide-react";
import { shallow } from "zustand/shallow";
import useEditorStore from "../stores/useEditorStore";
import { useT } from "../i18n/useT";

const labelKeys = {
  blur: "props.mode.blur",
  crop: "props.mode.crop",
  text: "props.mode.text",
  image: "props.mode.image",
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
  moveUpTitle,
  moveDownTitle,
  duplicateTitle,
  removeTitle,
  isSelected,
  onSelect,
  onMoveUp,
  onMoveDown,
  onDuplicate,
  onRemove,
}) {
  return (
    <div
      className="flex items-center gap-2 p-2 rounded"
      style={{
        background: isSelected ? "rgba(0,240,234,0.12)" : "var(--bg-elevated)",
        border: `1px solid ${isSelected ? "var(--accent)" : "transparent"}`,
      }}
    >
      <div
        className="w-2 h-2 rounded-full flex-shrink-0"
        style={{ background: color || "var(--text-dim)" }}
      />
      <button
        type="button"
        onClick={() => onSelect(i)}
        className="flex-1 text-left text-[11px] font-medium min-w-0"
        style={{ color: "var(--text-primary)" }}
      >
        {label}
        {op.mode === "text" && op.text
          ? ` "${op.text.slice(0, 20)}${op.text.length > 20 ? "…" : ""}"`
          : ""}
      </button>
      <div className="flex items-center gap-0.5">
        <button
          onClick={() => onMoveUp(i)}
          disabled={i === 0}
          className="text-[10px] p-0.5 rounded hover:bg-white/10"
          style={{ color: "var(--text-dim)" }}
          title={moveUpTitle}
          aria-label={moveUpTitle}
        >
          <ChevronUp size={12} />
        </button>
        <button
          onClick={() => onMoveDown(i)}
          disabled={i === count - 1}
          className="text-[10px] p-0.5 rounded hover:bg-white/10"
          style={{ color: "var(--text-dim)" }}
          title={moveDownTitle}
          aria-label={moveDownTitle}
        >
          <ChevronDown size={12} />
        </button>
        <button
          onClick={() => onDuplicate(i)}
          className="text-[10px] p-0.5 rounded hover:bg-white/10"
          style={{ color: "var(--text-dim)" }}
          title={duplicateTitle}
          aria-label={duplicateTitle}
        >
          <Copy size={12} />
        </button>
        <button
          onClick={() => onRemove(i)}
          className="text-[10px] p-0.5 rounded hover:bg-red-500/20 hover:text-red-400"
          style={{ color: "var(--text-dim)" }}
          title={removeTitle}
          aria-label={removeTitle}
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
});

export default function LayerList() {
  const { ops, selectedOperationIdx } = useEditorStore(
    (s) => ({
      selectedIdx: s.selectedIdx,
      selectedOperationIdx: s.selectedOperationIdx,
      ops:
        s.selectedIdx >= 0 && s.selectedIdx < s.queue.length
          ? s.queue[s.selectedIdx].operations
          : null,
    }),
    shallow,
  );
  const t = useT();
  const getState = useEditorStore.getState;
  // Stable, index-parameterized callbacks. Defined once so their identities
  // don't change on every LayerList render — otherwise the memo() on LayerRow
  // is defeated and every row re-renders on each selection change. The row
  // passes its own `i` when invoking them.
  const handleSelect = useCallback((i) => getState().selectOperation(i), [getState]);
  const handleMoveUp = useCallback((i) => getState().moveOperation(i, i - 1), [getState]);
  const handleMoveDown = useCallback((i) => getState().moveOperation(i, i + 1), [getState]);
  const handleDuplicate = useCallback((i) => getState().duplicateOperation(i), [getState]);
  const handleRemove = useCallback((i) => getState().removeOperation(i), [getState]);
  const layerCount = ops?.length ?? 0;

  return (
    <div className="cap-section">
      <div className="cap-section-title">
        {t("props.layers")} ({layerCount})
      </div>
      {!ops || ops.length === 0 ? (
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
              moveUpTitle={t("props.actions.moveUp")}
              moveDownTitle={t("props.actions.moveDown")}
              duplicateTitle={t("props.actions.duplicate")}
              removeTitle={t("props.actions.deleteLayer")}
              isSelected={selectedOperationIdx === i}
              onSelect={handleSelect}
              onMoveUp={handleMoveUp}
              onMoveDown={handleMoveDown}
              onDuplicate={handleDuplicate}
              onRemove={handleRemove}
            />
          ))}
        </div>
      )}
    </div>
  );
}
