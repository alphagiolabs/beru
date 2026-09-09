import { createOperation } from "./operation.js";
import {
  findTextOpForRegion,
  getGlobalTextStyleFromState,
  mergeTextStyles,
  pickTextStyle,
} from "./text-style.js";

export function applyBatchTextOperations(
  item,
  templateRegions,
  globalStyle,
  resolveText,
  videoIdx,
) {
  let ops = item.operations.map((op) => ({
    ...op,
    region: op.region ? { ...op.region } : null,
  }));
  if (!templateRegions?.length) return ops;

  for (const tr of templateRegions) {
    const text = String(resolveText(videoIdx, tr.id) ?? "").trim();
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

function resolvePreviewText(state, videoIdx, regionId) {
  if (typeof state.getBatchPreviewText === "function") {
    return String(state.getBatchPreviewText(videoIdx, regionId) ?? "");
  }
  const tr = state.templateRegions?.find((r) => r.id === regionId);
  return tr?.label || "Texto de ejemplo";
}

export function buildBatchTextOperationsForPreview(state, videoIdx) {
  const { queue, templateRegions } = state;
  const item = queue[videoIdx];
  if (!item) return [];

  return applyBatchTextOperations(
    item,
    templateRegions,
    getGlobalTextStyleFromState(state),
    (idx, regionId) => resolvePreviewText(state, idx, regionId),
    videoIdx,
  );
}
