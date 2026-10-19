import { describe, expect, it } from "vitest";
import { clipLayerGeometry, normalizeClipTransform } from "../shared/clip-transform.js";

const CANVAS = { width: 320, height: 240 };
const SOURCE = { width: 640, height: 360 };
const DEFAULT_CLIP_TRANSFORM = normalizeClipTransform({});

const transformOf = (changes) => ({ ...DEFAULT_CLIP_TRANSFORM, ...changes });

function mapPoint(matrix, u, v) {
  const [a, b, c, d, e, f] = matrix;
  return [a * u + c * v + e, b * u + d * v + f];
}

describe("clipLayerGeometry", () => {
  it("places an untouched clip exactly where the export's fit puts it", () => {
    const { frame, matrix } = clipLayerGeometry(DEFAULT_CLIP_TRANSFORM, SOURCE, CANVAS);
    expect(frame).toEqual({ left: 0, top: 30, width: 320, height: 180 });
    expect(mapPoint(matrix, SOURCE.width, SOURCE.height)).toEqual([320, 180]);
  });

  it("covers the canvas when the clip is filled, and lets the edges leave it", () => {
    const { frame } = clipLayerGeometry(transformOf({ fit: "fill" }), SOURCE, CANVAS);
    expect(frame.height).toBeCloseTo(240, 6);
    expect(frame.width).toBeCloseTo(426.667, 3);
    expect(frame.left).toBeCloseTo(-53.333, 3);
    expect(frame.top).toBe(0);
  });

  it("swaps the picture's sides when it is rotated a quarter turn", () => {
    const { frame, matrix } = clipLayerGeometry(transformOf({ rotate: 90 }), SOURCE, CANVAS);
    expect(frame.width).toBeCloseTo(135, 6);
    expect(frame.height).toBeCloseTo(240, 6);
    expect(frame.left).toBeCloseTo(92.5, 6);
    const [x, y] = mapPoint(matrix, 0, 0);
    expect(x).toBeCloseTo(frame.width, 6);
    expect(y).toBeCloseTo(0, 6);
  });

  it("mirrors the picture inside its frame when flipped", () => {
    const { frame, matrix } = clipLayerGeometry(transformOf({ flipH: true }), SOURCE, CANVAS);
    const [x, y] = mapPoint(matrix, 0, 0);
    expect(x).toBeCloseTo(frame.width, 6);
    expect(y).toBeCloseTo(0, 6);
  });

  it("maps the crop's four corners onto the four corners of the frame, for every rotation and flip", () => {
    const crop = { x: 0.25, y: 0.1, w: 0.5, h: 0.6 };
    const x0 = crop.x * SOURCE.width;
    const y0 = crop.y * SOURCE.height;
    const x1 = x0 + crop.w * SOURCE.width;
    const y1 = y0 + crop.h * SOURCE.height;
    for (const rotate of [0, 90, 180, 270]) {
      for (const [flipH, flipV] of [
        [false, false],
        [true, false],
        [false, true],
        [true, true],
      ]) {
        const { frame, matrix } = clipLayerGeometry(
          transformOf({ crop, rotate, flipH, flipV }),
          SOURCE,
          CANVAS,
        );
        const corners = [
          mapPoint(matrix, x0, y0),
          mapPoint(matrix, x1, y0),
          mapPoint(matrix, x0, y1),
          mapPoint(matrix, x1, y1),
        ];
        const expected = [
          [0, 0],
          [frame.width, 0],
          [0, frame.height],
          [frame.width, frame.height],
        ];
        for (const corner of expected) {
          const hit = corners.find(
            ([x, y]) => Math.abs(x - corner[0]) < 1e-6 && Math.abs(y - corner[1]) < 1e-6,
          );
          expect(hit, `rotate ${rotate} flips ${flipH}/${flipV} misses ${corner}`).toBeDefined();
        }
      }
    }
  });

  it("zooms around the canvas centre and then applies the offset", () => {
    const zoomed = clipLayerGeometry(transformOf({ zoom: 2 }), SOURCE, CANVAS).frame;
    expect(zoomed.width).toBeCloseTo(640, 6);
    expect(zoomed.left).toBeCloseTo(-160, 6);
    const shifted = clipLayerGeometry(
      transformOf({ offsetX: 0.5, offsetY: -0.25 }),
      SOURCE,
      CANVAS,
    ).frame;
    expect(shifted.left).toBeCloseTo(160, 6);
    expect(shifted.top).toBeCloseTo(30 - 60, 6);
  });

  it("works from the crop alone, so a cropped clip fills its frame exactly", () => {
    const crop = { x: 0.5, y: 0, w: 0.5, h: 1 };
    const { frame, matrix } = clipLayerGeometry(transformOf({ crop }), SOURCE, CANVAS);
    expect(frame.height).toBeCloseTo(240, 6);
    const [x, y] = mapPoint(matrix, SOURCE.width / 2, 0);
    expect(x).toBeCloseTo(0, 9);
    expect(y).toBeCloseTo(0, 9);
  });
});
