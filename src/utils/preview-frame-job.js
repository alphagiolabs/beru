import { createOperation } from "./types.js";
import {
  findTextOpForRegion,
  getGlobalTextStyleFromState,
  mergeTextStyles,
  pickTextStyle,
} from "./text-style.js";

/**
 * Resolve the text FFmpeg preview should draw for a template region.
 * Must match the CSS live preview (`getBatchPreviewText`): real cell/op text
 * when present, otherwise the sample label so style/position parity is visible.
 */
function resolvePreviewText(state, videoIdx, regionId) {
  if (typeof state.getBatchPreviewText === "function") {
    return String(state.getBatchPreviewText(videoIdx, regionId) ?? "");
  }
  if (typeof state.getCellTextForRegion === "function") {
    const cell = String(state.getCellTextForRegion(videoIdx, regionId) ?? "").trim();
    if (cell) return cell;
  }
  const tr = state.templateRegions?.find((r) => r.id === regionId);
  return tr?.label || "Texto de ejemplo";
}

/** Build text operations for one queue item without mutating store (batch preview). */
export function buildBatchTextOperationsForPreview(state, videoIdx) {
  const { queue, templateRegions } = state;
  const item = queue[videoIdx];
  if (!item) return [];

  let ops = item.operations.map((op) => ({
    ...op,
    region: op.region ? { ...op.region } : null,
  }));

  if (!templateRegions?.length) return ops;

  const globalStyle = getGlobalTextStyleFromState(state);

  for (const tr of templateRegions) {
    // Same source as CSS overlays — not export materialize (which drops empty cells).
    const text = resolvePreviewText(state, videoIdx, tr.id).trim();
    const { op, opIdx } = findTextOpForRegion(ops, tr.region, tr.id);

    if (text) {
      const baseStyle = mergeTextStyles(globalStyle, tr.style, op || {});
      if (opIdx >= 0) {
        ops[opIdx] = {
          ...ops[opIdx],
          batchRegionId: tr.id,
          text,
          ...pickTextStyle(baseStyle),
        };
      } else {
        ops.push(
          createOperation({
            mode: "text",
            batchRegionId: tr.id,
            region: { ...tr.region },
            text,
            ...pickTextStyle(baseStyle),
          }),
        );
      }
    } else if (opIdx >= 0) {
      ops = ops.filter((_, i) => i !== opIdx);
    }
  }

  return ops;
}
