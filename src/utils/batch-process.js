/** Helpers for batch text (Texto en lote) processing validation. */

export function hasVideoDimensions(item) {
  return Number(item?.width || 0) > 0 && Number(item?.height || 0) > 0;
}

/** True when the queue item has at least one non-empty text value for a template region. */
export function videoHasBatchText(videoIdx, templateRegions, getCellTextForRegion) {
  if (!templateRegions?.length) return true;
  return templateRegions.some(
    (tr) => String(getCellTextForRegion(videoIdx, tr.id) ?? "").trim().length > 0,
  );
}

/** Videos in batch mode that still have no text in any template column. */
export function listVideosMissingBatchText(queue, templateRegions, getCellTextForRegion) {
  if (!templateRegions?.length) return [];
  return queue
    .map((item, idx) => ({ item, idx }))
    .filter(({ idx }) => !videoHasBatchText(idx, templateRegions, getCellTextForRegion))
    .map(({ item }) => item.customOutputName || item.filename);
}

/** Filter operations sent to FFmpeg — drop blank drawtext ops. */
export function filterOperationsForExport(operations) {
  if (!Array.isArray(operations)) return [];
  return operations.filter((op) => {
    if (op?.mode !== "text") return true;
    return String(op.text ?? "").trim().length > 0;
  });
}
