// Per-video geometry after the crops: quarter-turn rotation, flips and output height.
// Mirrors python/frame_geometry.py; tests/fixtures/output-geometry-cases.json keeps both in step.

import { IDENTITY_TRANSFORM, normalizeTransform } from "../../shared/video-transform.js";
export { IDENTITY_TRANSFORM, normalizeTransform };

// Python's round(): ties go to the even integer.
const roundHalfEven = (n) => {
  const rounded = Math.round(n);
  return Math.abs(n % 1) === 0.5 && rounded % 2 !== 0 ? rounded - 1 : rounded;
};

const evenPixels = (n) => Math.max(2, n % 2 ? n - 1 : n);

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
    x.outputHeight === y.outputHeight
  );
}

// Job wire format (snake_case), consumed by normalizeJob and the Processor.
export function transformJobFields(value) {
  const t = normalizeTransform(value);
  return {
    rotation: t.rotation,
    flip_h: t.flipH,
    flip_v: t.flipV,
    output_height: t.outputHeight,
  };
}

/**
 * Output frame after rotation and output height. Flips keep the size.
 * The height is never raised above the rotated frame's height.
 *
 * @param {{ width: number, height: number }} frame size after the crops
 * @param {object} [transform]
 * @returns {{ width: number, height: number, resized: boolean }}
 */
export function outputDimensions(frame, transform = IDENTITY_TRANSFORM) {
  const t = normalizeTransform(transform);
  let width = frame.width;
  let height = frame.height;
  if (t.rotation === 90 || t.rotation === 270) [width, height] = [height, width];
  if (t.outputHeight === null || t.outputHeight >= height) {
    return { width, height, resized: false };
  }
  const nextHeight = evenPixels(t.outputHeight);
  const nextWidth = evenPixels(roundHalfEven((width * nextHeight) / height));
  return { width: nextWidth, height: nextHeight, resized: true };
}
