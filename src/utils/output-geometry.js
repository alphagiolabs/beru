// Per-video geometry after the crops: quarter-turn rotation, flips and output height.
// Mirrors python/frame_geometry.py; tests/fixtures/output-geometry-cases.json keeps both in step.

import {
  FIT_MODES,
  IDENTITY_TRANSFORM,
  normalizeTransform,
  transformJobFields,
} from "../../shared/video-transform.js";
export { FIT_MODES, IDENTITY_TRANSFORM, normalizeTransform, transformJobFields };

// Python's round(): ties go to the even integer.
const roundHalfEven = (n) => {
  const rounded = Math.round(n);
  return Math.abs(n % 1) === 0.5 && rounded % 2 !== 0 ? rounded - 1 : rounded;
};

const evenPixels = (n) => Math.max(2, n % 2 ? n - 1 : n);
const evenFloor = (n) => Math.floor(n / 2) * 2;

export const ASPECT_FILL_TOLERANCE = 0.01;

export function isIdentityTransform(value) {
  const t = normalizeTransform(value);
  return t.rotation === 0 && !t.flipH && !t.flipV && t.outputHeight === null;
}

export function transformsEqual(a, b) {
  const x = normalizeTransform(a);
  const y = normalizeTransform(b);
  return (
    x.rotation === y.rotation &&
    x.flipH === y.flipH &&
    x.flipV === y.flipV &&
    x.outputHeight === y.outputHeight &&
    x.outputWidth === y.outputWidth &&
    (x.outputWidth === null || x.fitMode === y.fitMode)
  );
}

export function outputLayout(croppedFrame, transform = IDENTITY_TRANSFORM) {
  const t = normalizeTransform(transform);
  let width = croppedFrame.width;
  let height = croppedFrame.height;
  if (t.rotation === 90 || t.rotation === 270) [width, height] = [height, width];
  const full = (w, h, resized) => ({
    width: w,
    height: h,
    resized,
    content: { x: 0, y: 0, w, h },
  });
  if (t.outputWidth !== null) {
    const outW = evenPixels(t.outputWidth);
    const outH = evenPixels(t.outputHeight);
    const mismatch = Math.abs(outW * height - outH * width) / (outH * width);
    if (t.fitMode === "stretch" || mismatch <= ASPECT_FILL_TOLERANCE) {
      return full(outW, outH, outW !== width || outH !== height);
    }
    const scale =
      t.fitMode === "crop"
        ? Math.max(outW / width, outH / height)
        : Math.min(outW / width, outH / height);
    const w = evenPixels(roundHalfEven(width * scale));
    const h = evenPixels(roundHalfEven(height * scale));
    return {
      width: outW,
      height: outH,
      resized: true,
      content: { x: evenFloor((outW - w) / 2), y: evenFloor((outH - h) / 2), w, h },
    };
  }
  if (t.outputHeight === null || t.outputHeight >= height) return full(width, height, false);
  const nextHeight = evenPixels(t.outputHeight);
  const nextWidth = evenPixels(roundHalfEven((width * nextHeight) / height));
  return full(nextWidth, nextHeight, true);
}

export function outputDimensions(frame, transform = IDENTITY_TRANSFORM) {
  const { width, height, resized } = outputLayout(frame, transform);
  return { width, height, resized };
}
