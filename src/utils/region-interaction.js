/**
 * Pure geometry for DOM-based region move/resize (text selection chrome).
 * Coordinates are normalized 0..1 video space — same contract as the store.
 */
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

/**
 * @param {HandleId} handle
 * @returns {string}
 */
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
 * Convert a client-pixel pointer delta into normalized video delta.
 * contentW/H must be the *visible letterboxed content* size in CSS pixels
 * (from getBoundingClientRect-based contentRect) so zoom is accounted for.
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

/**
 * @param {Region} start
 * @param {number} dx
 * @param {number} dy
 * @param {number} [minSize]
 * @returns {Region | null}
 */
export function applyMove(start, dx, dy, minSize = MIN_SIZE) {
  if (!start) return null;
  return clampRegionToVideo(
    { x: start.x + dx, y: start.y + dy, w: start.w, h: start.h },
    1,
    1,
    minSize,
  );
}

/**
 * Resize from a handle. Same semantics as useCanvas edge/corner logic.
 *
 * @param {Region} start
 * @param {HandleId} handle
 * @param {number} dx
 * @param {number} dy
 * @param {number} [minSize]
 * @returns {Region | null}
 */
export function applyResize(start, handle, dx, dy, minSize = MIN_SIZE) {
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

  return clampRegionToVideo({ x: nx, y: ny, w: nw, h: nh }, 1, 1, minSize);
}

/**
 * Sample zoom-aware content size from a video element.
 * Uses getBoundingClientRect so CSS scale on ancestors is included.
 *
 * @param {HTMLVideoElement | null | undefined} videoEl
 * @returns {{ width: number, height: number } | null}
 */
export function getContentPx(videoEl) {
  if (!videoEl) return null;
  const br = videoEl.getBoundingClientRect();
  if (!br.width || !br.height) return null;
  // Intrinsic size not ready yet — use full element so resize still works.
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
