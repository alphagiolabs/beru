import { describe, expect, it } from "vitest";
import {
  createDelogoRenderSession,
  inpaintInto,
  mosaicInto,
  mosaicOutputSize,
  temporalSampleSize,
} from "../src/utils/delogo-render-core.js";
import { referenceMosaic } from "./fixtures/delogo-render-reference.js";

function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function randomData(rng, length) {
  const data = new Uint8ClampedArray(length);
  for (let i = 0; i < length; i++) data[i] = Math.floor(rng() * 256);
  return data;
}

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

describe("delogo render core parity with the legacy inline kernels", () => {
  it("renders mosaic blocks bit-identically", () => {
    const rng = makeRng(0xbeef);
    for (const [sw, sh, blockSize] of [
      [1, 1, 1],
      [5, 1, 2],
      [1, 5, 2],
      [9, 7, 3],
      [32, 18, 16],
      [23, 13, 7],
      [40, 40, 1],
      [13, 11, 40],
      [6, 6, 4],
    ]) {
      const data = randomData(rng, sw * sh * 4);
      const { cols, rows } = mosaicOutputSize(sw, sh, blockSize);
      const out = new Uint8ClampedArray(cols * rows * 4);
      mosaicInto(data, sw, sh, blockSize, out);
      expect(out).toEqual(referenceMosaic(data, sw, sh, blockSize));
    }
  });

  it("preserves the source when no surrounding context is available", () => {
    const rng = makeRng(0xf00d);
    for (const [sw, sh] of [
      [1, 1],
      [1, 10],
      [10, 1],
      [2, 2],
      [9, 7],
      [33, 17],
    ]) {
      const sData = randomData(rng, sw * sh * 4);
      const dData = new Uint8ClampedArray(sw * sh * 4);
      inpaintInto(sData, dData, sw, sh);
      expect(dData).toEqual(sData);
    }
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

  it("reports mosaic output size as the tiny grid", () => {
    const result = createDelogoRenderSession().compute(
      "mosaic",
      { blockSize: 16 },
      constantFrame(32, 18, 128),
      32,
      18,
    );
    expect(result.width).toBe(2);
    expect(result.height).toBe(2);
    expect(result.data.length).toBe(2 * 2 * 4);
    expect(result.data[0]).toBe(128);
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
