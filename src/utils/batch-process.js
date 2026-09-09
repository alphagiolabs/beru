export { hasVideoDimensions } from "../../shared/has-video-dimensions.js";

export function videoHasBatchText(videoIdx, templateRegions, getCellTextForRegion) {
  if (!templateRegions?.length) return true;
  return templateRegions.some(
    (tr) => String(getCellTextForRegion(videoIdx, tr.id) ?? "").trim().length > 0,
  );
}

export function listVideosMissingBatchText(queue, templateRegions, getCellTextForRegion) {
  if (!templateRegions?.length) return [];
  return queue
    .map((item, idx) => ({ item, idx }))
    .filter(({ idx }) => !videoHasBatchText(idx, templateRegions, getCellTextForRegion))
    .map(({ item }) => item.customOutputName || item.filename);
}

const UNSAFE_FILENAME_RE = new RegExp(
  `[<>:"/\\\\|?*${String.fromCharCode(0)}-${String.fromCharCode(31)}${String.fromCharCode(127)}]`,
  "g",
);

export function sanitizeFilenamePart(value) {
  return String(value ?? "")
    .trim()
    .replace(UNSAFE_FILENAME_RE, " ")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "");
}

export function buildIdTextOutputName(idValue, textValue, exportFormat) {
  const id = sanitizeFilenamePart(idValue);
  const text = sanitizeFilenamePart(textValue);
  const ext = sanitizeFilenamePart(exportFormat || "mp4") || "mp4";
  if (!id || !text) return "";
  return `${id}_${text}.${ext.replace(/^\.+/, "") || "mp4"}`;
}
