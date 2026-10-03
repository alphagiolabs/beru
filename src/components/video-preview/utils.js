import { isOpActive } from "../../utils/operation";

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;
export const ZOOM_STEP = 0.1;

export const REGION_EDIT_MODES = new Set(["blur", "delogo", "crop"]);
const FRAME_DRIVEN_DELOGO_METHODS = new Set(["blur", "temporal", "mirror", "mosaic", "inpaint"]);

export const REGION_EDIT_LABEL = {
  blur: "catalog.editLabel.blur",
  delogo: "catalog.editLabel.delogo",
  crop: "catalog.editLabel.crop",
};

export function isPreviewOpActive(op, t, sidebarMode) {
  return (
    isOpActive(op, t) ||
    (sidebarMode === "logo" &&
      (op.mode === "blur" ||
        (op.mode === "delogo" && FRAME_DRIVEN_DELOGO_METHODS.has(op.delogoMethod || "blur"))))
  );
}

export function activeOpsBitmask(ops, t) {
  if (!ops?.length) return "";
  let key = "";
  for (const op of ops) key += isOpActive(op, t) ? "1" : "0";
  return key;
}

export const opModeColor = {
  text: "#a855f7",
  blur: "#00f0ea",
  delogo: "#f43f5e",
  crop: "#fbbf24",
  image: "#10b981",
};

export function resolvedDuration(video, fallback) {
  const mediaDuration = Number(video?.duration);
  if (Number.isFinite(mediaDuration) && mediaDuration > 0) return mediaDuration;
  const fallbackDuration = Number(fallback);
  return Number.isFinite(fallbackDuration) && fallbackDuration > 0 ? fallbackDuration : 0;
}
