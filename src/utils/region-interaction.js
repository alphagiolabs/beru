import { clampRegionToVideo } from "./video-utils";

const MIN_SIZE = 0.01;

/** @typedef {{ x: number, y: number, w: number, h: number }} Region */
/** @typedef {"tl"|"tc"|"tr"|"ml"|"mr"|"bl"|"bc"|"br"} HandleId */

export const RESIZE_HANDLES = /** @type {const} */ ([
  "tl",
  "tc",
  "tr",
  "ml",
  "mr",
  "bl",
  "bc",
  "br",
]);

export function cursorForHandle(handle) {
  const m = {
    tl: "nwse-resize",
    tc: "ns-resize",
    tr: "nesw-resize",
    ml: "ew-resize",
    mr: "ew-resize",
    bl: "nesw-resize",
    bc: "ns-resize",
    br: "nwse-resize",
  };
  return m[handle] || "move";
}

/**
 * contentW/H is the visible letterboxed content in CSS pixels (getBoundingClientRect).
 *
 * @param {{ clientX: number, clientY: number }} start
 * @param {{ clientX: number, clientY: number }} now
 * @param {{ width: number, height: number }} contentPx
 */
export function pointerDeltaToNorm(start, now, contentPx) {
  const w = contentPx?.width || 1;
  const h = contentPx?.height || 1;
  return {
    dx: (now.clientX - start.clientX) / w,
    dy: (now.clientY - start.clientY) / h,
  };
}

export function applyMove(start, dx, dy, minSize = MIN_SIZE) {
  if (!start) return null;
  return clampRegionToVideo(
    { x: start.x + dx, y: start.y + dy, w: start.w, h: start.h },
    1,
    1,
    minSize,
  );
}

export function applyResizeRaw(start, handle, dx, dy, minSize = MIN_SIZE) {
  if (!start || !handle) return null;
  let nx = start.x;
  let ny = start.y;
  let nw = start.w;
  let nh = start.h;

  if (handle.includes("l")) {
    nx = start.x + dx;
    nw = start.w - dx;
  }
  if (handle.includes("r")) {
    nw = start.w + dx;
  }
  if (handle.includes("t") || handle === "tc") {
    ny = start.y + dy;
    nh = start.h - dy;
  }
  if (handle.includes("b") || handle === "bc") {
    nh = start.h + dy;
  }

  if (nw < minSize) {
    nw = minSize;
    if (handle.includes("l")) nx = start.x + start.w - minSize;
  }
  if (nh < minSize) {
    nh = minSize;
    if (handle.includes("t") || handle === "tc") ny = start.y + start.h - minSize;
  }

  return { x: nx, y: ny, w: nw, h: nh };
}

export function applyResize(start, handle, dx, dy, minSize = MIN_SIZE) {
  const next = applyResizeRaw(start, handle, dx, dy, minSize);
  if (!next) return null;
  return clampRegionToVideo(next, 1, 1, minSize);
}

// Uses getBoundingClientRect so CSS scale on ancestors is included.
export function getContentPx(videoEl) {
  if (!videoEl) return null;
  const br = videoEl.getBoundingClientRect();
  if (!br.width || !br.height) return null;
  if (!videoEl.videoWidth || !videoEl.videoHeight) {
    return { width: br.width, height: br.height };
  }
  const vr = videoEl.videoWidth / videoEl.videoHeight;
  const cr = br.width / br.height;
  if (vr > cr) {
    return { width: br.width, height: br.width / vr };
  }
  return { width: br.height * vr, height: br.height };
}
