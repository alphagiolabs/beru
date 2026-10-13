import { denormalizeRegion } from "./types.js";

// Mirrors the Processor's crop chain (python/filters.py): a crop without a time window
// clips to the current frame, changes its size (even-rounded) and shifts later crops;
// a timed crop only zooms and keeps the frame. Regions are source-pixel based.

const evenPixels = (n) => (n % 2 ? Math.max(2, n - 1) : n);

const isTimed = (op) => op.startTime != null || op.endTime != null;
const isTimeDisabled = (op) =>
  op.startTime != null && op.endTime != null && Number(op.endTime) <= Number(op.startTime);

// Pixels as the Job sends them (denormalizeRegion), clamped like Python's pixel path.
function sourcePixels(region, dims) {
  const px = denormalizeRegion(region, dims.w, dims.h);
  if (!(px?.w > 0 && px.h > 0)) return null;
  const x = Math.max(0, px.x);
  const y = Math.max(0, px.y);
  return {
    x,
    y,
    w: Math.max(1, Math.min(dims.w - x, px.w)),
    h: Math.max(1, Math.min(dims.h - y, px.h)),
  };
}

/**
 * Frame size after applying the crops in `operations`, in order.
 * Pass the chain up to the operation of interest (inclusive).
 *
 * @param {Array<{mode: string, region: object, startTime?: number|null, endTime?: number|null}>} operations
 * @param {{ w: number, h: number }} dims source presentation size in pixels
 * @returns {{ width: number, height: number }}
 */
export function frameAfterCrops(operations, dims) {
  let width = dims.w;
  let height = dims.h;
  let cropX = 0;
  let cropY = 0;
  for (const op of operations) {
    if (op?.mode !== "crop" || !op.region || isTimeDisabled(op)) continue;
    const region = sourcePixels(op.region, dims);
    if (!region) continue;
    const x = region.x - cropX;
    const y = region.y - cropY;
    if (x >= width || y >= height || x + region.w <= 0 || y + region.h <= 0) continue;
    const left = Math.max(0, x);
    const top = Math.max(0, y);
    const w = Math.min(width, x + region.w) - left;
    const h = Math.min(height, y + region.h) - top;
    if (w < 2 || h < 2 || isTimed(op)) continue;
    width = evenPixels(w);
    height = evenPixels(h);
    cropX += left;
    cropY += top;
  }
  return { width, height };
}
