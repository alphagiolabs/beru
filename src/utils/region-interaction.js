import { clampRegionToVideo } from "./video-utils";

const MIN_SIZE = 0.01;

export const RESIZE_HANDLES = ["tl", "tc", "tr", "ml", "mr", "bl", "bc", "br"];

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

export function regionFromFieldPixels(region, key, px, dims) {
  const dim = key === "x" || key === "w" ? dims?.w : dims?.h;
  if (!Number.isFinite(px) || !(dim > 0)) return null;
  return clampRegionToVideo({ ...region, [key]: Math.round(px) / dim });
}

export function fitRegionToAspect(region, aspect, dims) {
  if (!region || !(aspect > 0) || !(dims?.w > 0) || !(dims?.h > 0)) return null;
  const W = dims.w;
  const H = dims.h;
  const cx = (region.x + region.w / 2) * W;
  const cy = (region.y + region.h / 2) * H;
  let w = region.w * W;
  let h = w / aspect;
  if (h < MIN_SIZE * H) {
    h = MIN_SIZE * H;
    w = h * aspect;
  }
  if (w < MIN_SIZE * W) {
    w = MIN_SIZE * W;
    h = w / aspect;
  }
  if (h > H) {
    h = H;
    w = H * aspect;
  }
  if (w > W) {
    w = W;
    h = W / aspect;
  }
  const x = Math.min(Math.max(0, cx - w / 2), W - w);
  const y = Math.min(Math.max(0, cy - h / 2), H - h);
  return clampRegionToVideo({ x: x / W, y: y / H, w: w / W, h: h / H });
}

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
