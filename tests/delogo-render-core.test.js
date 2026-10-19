import { describe, expect, it } from "vitest";
import { createDelogoRenderSession, temporalSampleSize } from "../src/utils/delogo-render-core.js";

function constantFrame(w, h, value) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = value;
    data[i * 4 + 1] = value;
    data[i * 4 + 2] = value;
    data[i * 4 + 3] = 255;
  }
  return data;
}

describe("mosaic pixels through the render session", () => {
  it.each([
    {
      name: "normal grid with independent RGB channels and rounded averages",
      size: [4, 4],
      block: 2,
      pixels: [
        [1, 2, 3, 0],
        [2, 3, 4, 255],
        [21, 42, 63, 17],
        [22, 43, 64, 255],
        [3, 4, 5, 9],
        [4, 5, 6, 128],
        [23, 44, 65, 200],
        [24, 45, 66, 77],
        [101, 102, 103, 1],
        [102, 103, 104, 2],
        [201, 202, 203, 3],
        [202, 203, 204, 4],
        [103, 104, 105, 5],
        [104, 105, 106, 6],
        [203, 204, 205, 7],
        [204, 205, 206, 8],
      ],
      expectedSize: [2, 2],
      expected: [
        [3, 4, 5, 255],
        [23, 44, 65, 255],
        [103, 104, 105, 255],
        [203, 204, 205, 255],
      ],
    },
    {
      name: "partial blocks on the right and bottom edges",
      size: [3, 3],
      block: 2,
      pixels: [
        [0, 10, 20, 0],
        [1, 11, 21, 1],
        [10, 20, 30, 2],
        [2, 12, 22, 3],
        [3, 13, 23, 4],
        [11, 21, 31, 5],
        [20, 30, 40, 6],
        [21, 31, 41, 7],
        [30, 40, 50, 8],
      ],
      expectedSize: [2, 2],
      expected: [
        [2, 12, 22, 255],
        [11, 21, 31, 255],
        [21, 31, 41, 255],
        [30, 40, 50, 255],
      ],
    },
    {
      name: "one-pixel blocks keep RGB and make every output pixel opaque",
      size: [2, 2],
      block: 1,
      pixels: [
        [5, 6, 7, 0],
        [20, 30, 40, 8],
        [100, 90, 80, 128],
        [0, 127, 255, 255],
      ],
      expectedSize: [2, 2],
      expected: [
        [5, 6, 7, 255],
        [20, 30, 40, 255],
        [100, 90, 80, 255],
        [0, 127, 255, 255],
      ],
    },
    {
      name: "a block larger than both dimensions averages the whole image",
      size: [3, 2],
      block: 8,
      pixels: [
        [0, 10, 20, 1],
        [2, 12, 22, 2],
        [4, 14, 24, 3],
        [6, 16, 26, 4],
        [8, 18, 28, 5],
        [13, 23, 33, 6],
      ],
      expectedSize: [1, 1],
      expected: [[6, 16, 26, 255]],
    },
    {
      name: "a single pixel",
      size: [1, 1],
      block: 1,
      pixels: [[7, 100, 200, 0]],
      expectedSize: [1, 1],
      expected: [[7, 100, 200, 255]],
    },
    {
      name: "a one-row image with a partial final block",
      size: [3, 1],
      block: 2,
      pixels: [
        [0, 10, 20, 0],
        [3, 13, 23, 7],
        [20, 30, 40, 128],
      ],
      expectedSize: [2, 1],
      expected: [
        [2, 12, 22, 255],
        [20, 30, 40, 255],
      ],
    },
    {
      name: "a one-column image with a partial final block",
      size: [1, 3],
      block: 2,
      pixels: [
        [0, 10, 20, 0],
        [3, 13, 23, 7],
        [20, 30, 40, 128],
      ],
      expectedSize: [1, 2],
      expected: [
        [2, 12, 22, 255],
        [20, 30, 40, 255],
      ],
    },
  ])("renders $name", ({ size: [width, height], block, pixels, expectedSize, expected }) => {
    const result = createDelogoRenderSession().compute(
      "mosaic",
      { blockSize: block },
      Uint8ClampedArray.from(pixels.flat()),
      width,
      height,
    );
    expect([result.width, result.height]).toEqual(expectedSize);
    expect(Array.from(result.data)).toEqual(expected.flat());
  });
});

describe("delogo render session semantics", () => {
  it("discards the cached frame when the sample size changes at the same timestamp", () => {
    const session = createDelogoRenderSession();
    const params = { box: { x: 4, y: 4, w: 4, h: 4 }, radius: 7, timestamp: 0 };
    session.compute("temporal", params, constantFrame(16, 16, 255), 16, 16);
    const result = session.compute("temporal", params, constantFrame(20, 16, 0), 20, 16);
    expect(result.width).toBe(20);
    expect(result.height).toBe(16);
    expect(result.data).toHaveLength(20 * 16 * 4);
    expect(result.data[(4 * 20 + 4) * 4]).toBe(0);
  });

  it("clears the cached frame on reset before another clip starts at the same timestamp", () => {
    const session = createDelogoRenderSession();
    const params = { box: { x: 4, y: 4, w: 4, h: 4 }, radius: 7, timestamp: 0 };
    session.compute("temporal", params, constantFrame(16, 16, 255), 16, 16);
    session.reset();
    const result = session.compute("temporal", params, constantFrame(16, 16, 0), 16, 16);
    expect(result.data[(4 * 16 + 4) * 4]).toBe(0);
  });
});

describe("temporalSampleSize", () => {
  it("samples within the 1280x720 temporal capture cap", () => {
    expect(temporalSampleSize(3840, 2160)).toEqual({ sampleW: 1280, sampleH: 720 });
    expect(temporalSampleSize(320, 180)).toEqual({ sampleW: 320, sampleH: 180 });
    expect(temporalSampleSize(100, 4000)).toEqual({ sampleW: 18, sampleH: 720 });
    expect(temporalSampleSize(1, 1)).toEqual({ sampleW: 1, sampleH: 1 });
  });

  it("tightens to the visible bounds but never exceeds the cap", () => {
    expect(temporalSampleSize(3840, 2160, 480, 270)).toEqual({ sampleW: 480, sampleH: 270 });
    expect(temporalSampleSize(320, 180, 480, 270)).toEqual({ sampleW: 320, sampleH: 180 });
    expect(temporalSampleSize(3840, 2160, 2000, 2000)).toEqual({
      sampleW: 1280,
      sampleH: 720,
    });
    expect(temporalSampleSize(3840, 2160, 0, 0)).toEqual({ sampleW: 1, sampleH: 1 });
  });
});
