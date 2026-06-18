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

export default function LayerList() {
  const { selectedIdx, ops } = useEditorStore(
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
            <div
              key={op.id}
              className="flex items-center gap-2 p-2 rounded"
              style={{ background: "var(--bg-elevated)" }}
            >
              <div
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ background: colors[op.mode] || "var(--text-dim)" }}
              />
              <span
                className="flex-1 text-[11px] font-medium"
                style={{ color: "var(--text-primary)" }}
              >
                {t(labelKeys[op.mode] || op.mode)}
                {op.mode === "text" && op.text
                  ? ` "${op.text.slice(0, 20)}${op.text.length > 20 ? "…" : ""}"`
                  : ""}
              </span>
              <div className="flex items-center gap-0.5">
                <button
                  onClick={() => getState().moveOperation(i, i - 1)}
                  disabled={i === 0}
                  className="text-[10px] p-0.5 rounded hover:bg-white/10"
                  style={{ color: "var(--text-dim)" }}
                  title={t("props.actions.moveUp")}
                  aria-label={t("props.actions.moveUp")}
                >
                  <ChevronUp size={12} />
                </button>
                <button
                  onClick={() => getState().moveOperation(i, i + 1)}
                  disabled={i === ops.length - 1}
                  className="text-[10px] p-0.5 rounded hover:bg-white/10"
                  style={{ color: "var(--text-dim)" }}
                  title={t("props.actions.moveDown")}
                  aria-label={t("props.actions.moveDown")}
                >
                  <ChevronDown size={12} />
                </button>
                <button
                  onClick={() => getState().duplicateOperation(i)}
                  className="text-[10px] p-0.5 rounded hover:bg-white/10"
                  style={{ color: "var(--text-dim)" }}
                  title={t("props.actions.duplicate")}
                  aria-label={t("props.actions.duplicate")}
                >
                  <Copy size={12} />
                </button>
                <button
                  onClick={() => getState().removeOperation(i)}
                  className="text-[10px] p-0.5 rounded hover:bg-red-500/20 hover:text-red-400"
                  style={{ color: "var(--text-dim)" }}
                  title={t("props.actions.deleteLayer")}
                  aria-label={t("props.actions.deleteLayer")}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
