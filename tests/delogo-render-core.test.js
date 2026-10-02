import { describe, expect, it } from "vitest";
import {
  createDelogoRenderSession,
  inpaintInto,
  mosaicInto,
  mosaicOutputSize,
  temporalMedianInto,
  temporalSampleSize,
} from "../src/utils/delogo-render-core.js";
import {
  referenceInpaint,
  referenceMedianChannel,
  referenceMosaic,
  referenceQuickselectMedian,
  referenceTemporal,
} from "./fixtures/delogo-render-reference.js";

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
  it("computes the same median as both legacy implementations", () => {
    const rng = makeRng(0xc0ffee);
    for (let n = 1; n <= 15; n++) {
      for (let sample = 0; sample < 200; sample++) {
        const values = randomData(rng, n);
        const frames = Array.from(values, (v) => Uint8ClampedArray.of(v, 0, 0, 255));
        const out = new Uint8ClampedArray(4);
        temporalMedianInto(frames, out, 1);
        expect(out[0]).toBe(referenceMedianChannel(Array.from(values)));
        expect(out[0]).toBe(referenceQuickselectMedian(Uint8ClampedArray.from(values)));
      }
    }
  });

  it("renders temporal frames bit-identically", () => {
    const rng = makeRng(0x5eed);
    for (const [w, h] of [
      [1, 1],
      [4, 3],
      [17, 9],
      [33, 17],
    ]) {
      for (const n of [1, 2, 3, 7, 15]) {
        const frames = [];
        for (let f = 0; f < n; f++) frames.push(randomData(rng, w * h * 4));
        const out = new Uint8ClampedArray(w * h * 4);
        temporalMedianInto(frames, out, w * h);
        expect(out).toEqual(
          referenceTemporal(
            frames.map((data) => ({ data })),
            w * h,
          ),
        );
      }
    }
  });

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

  it("renders inpaint fills bit-identically", () => {
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
      expect(dData).toEqual(referenceInpaint(sData, sw, sh));
    }
  });
});

describe("delogo render session semantics", () => {
  it("caps the temporal history to the radius window", () => {
    const session = createDelogoRenderSession();
    session.compute("temporal", { radius: 1 }, constantFrame(1, 1, 10), 1, 1);
    session.compute("temporal", { radius: 1 }, constantFrame(1, 1, 20), 1, 1);
    session.compute("temporal", { radius: 1 }, constantFrame(1, 1, 30), 1, 1);
    const result = session.compute("temporal", { radius: 1 }, constantFrame(1, 1, 40), 1, 1);
    expect(result.data[0]).toBe(30);

    const wide = createDelogoRenderSession();
    for (let v = 1; v <= 15; v++) {
      wide.compute("temporal", { radius: 7 }, constantFrame(1, 1, v), 1, 1);
    }
    expect(wide.compute("temporal", { radius: 7 }, constantFrame(1, 1, 255), 1, 1).data[0]).toBe(9);
  });

  it("restarts the history when the sample size changes", () => {
    const session = createDelogoRenderSession();
    session.compute("temporal", { radius: 7 }, constantFrame(2, 2, 255), 2, 2);
    session.compute("temporal", { radius: 7 }, constantFrame(2, 2, 255), 2, 2);
    const result = session.compute("temporal", { radius: 7 }, constantFrame(1, 1, 0), 1, 1);
    expect(result.data[0]).toBe(0);
  });

  it("clears the history on reset()", () => {
    const session = createDelogoRenderSession();
    session.compute("temporal", { radius: 7 }, constantFrame(1, 1, 255), 1, 1);
    session.compute("temporal", { radius: 7 }, constantFrame(1, 1, 255), 1, 1);
    session.reset();
    const result = session.compute("temporal", { radius: 7 }, constantFrame(1, 1, 0), 1, 1);
    expect(result.data[0]).toBe(0);
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
