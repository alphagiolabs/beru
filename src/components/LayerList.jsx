import { memo, useCallback } from "react";
import { Trash2, Copy, ChevronUp, ChevronDown } from "lucide-react";
import { shallow } from "zustand/shallow";
import useEditorStore from "../stores/useEditorStore";
import { useT } from "../i18n/useT";
import { InspectorGroup } from "./inspector";

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
    <div className={`inspector-layer-row${isSelected ? " is-selected" : ""}`}>
      <div
        className="inspector-layer-dot"
        style={{ background: color || "var(--text-dim)" }}
        aria-hidden
      />
      <button
        type="button"
        onClick={() => onSelect(i)}
        className="inspector-layer-label"
        style={{ color: "var(--text-primary)" }}
      >
        {label}
        {op.mode === "text" && op.text
          ? ` "${op.text.slice(0, 20)}${op.text.length > 20 ? "…" : ""}"`
          : ""}
      </button>
      <div className="inspector-layer-actions">
        <button
          type="button"
          onClick={() => onMoveUp(i)}
          disabled={i === 0}
          className="inspector-layer-icon-btn"
          title={moveUpTitle}
          aria-label={moveUpTitle}
        >
          <ChevronUp size={12} />
        </button>
        <button
          type="button"
          onClick={() => onMoveDown(i)}
          disabled={i === count - 1}
          className="inspector-layer-icon-btn"
          title={moveDownTitle}
          aria-label={moveDownTitle}
        >
          <ChevronDown size={12} />
        </button>
        <button
          type="button"
          onClick={() => onDuplicate(i)}
          className="inspector-layer-icon-btn"
          title={duplicateTitle}
          aria-label={duplicateTitle}
        >
          <Copy size={12} />
        </button>
        <button
          type="button"
          onClick={() => onRemove(i)}
          className="inspector-layer-icon-btn inspector-layer-icon-btn--danger"
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
    <div className="inspector-layers">
      <InspectorGroup title={`${t("props.layers")} (${layerCount})`}>
        {!ops || ops.length === 0 ? (
          <p className="inspector-helper">{t("props.noLayers")}</p>
        ) : (
          <div className="inspector-layer-list">
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
      </InspectorGroup>
    </div>
  );
}
