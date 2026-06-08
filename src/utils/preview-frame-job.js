import { createOperation } from "./types.js";
import {
  findTextOpForRegion,
  getGlobalTextStyleFromState,
  mergeTextStyles,
  pickTextStyle,
} from "./text-style.js";

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
    const text = String(state.getCellTextForRegion(videoIdx, tr.id) ?? "").trim();
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
