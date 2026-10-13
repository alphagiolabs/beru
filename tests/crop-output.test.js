import { describe, it, expect } from "vitest";
import { frameAfterCrops } from "../src/utils/crop-output.js";

const dims = { w: 1280, h: 720 };
const crop = (region, timing = {}) => ({
  mode: "crop",
  region,
  startTime: null,
  endTime: null,
  ...timing,
});

describe("frameAfterCrops — Processor crop chain", () => {
  it("a permanent crop sets the output to its even-rounded size", () => {
    const ops = [crop({ x: 0.2, y: 0, w: 405 / 1280, h: 1 })];
    expect(frameAfterCrops(ops, dims)).toEqual({ width: 404, height: 720 });
  });

  it("a later crop is clipped to the cropped frame and shifted by the earlier one", () => {
    const ops = [crop({ x: 0.1, y: 0, w: 0.5, h: 1 }), crop({ x: 0.5, y: 0, w: 0.5, h: 1 })];
    expect(frameAfterCrops(ops, dims)).toEqual({ width: 128, height: 720 });
  });

  it("a timed crop zooms: it keeps the frame and does not shift later crops", () => {
    const ops = [
      crop({ x: 0.1, y: 0, w: 0.5, h: 1 }, { startTime: 1, endTime: 3 }),
      crop({ x: 0.5, y: 0, w: 0.5, h: 1 }),
    ];
    expect(frameAfterCrops(ops, dims)).toEqual({ width: 640, height: 720 });
  });

  it("rounds the region like the Job before clipping (x 10.5 -> 11, export 628)", () => {
    const ops = [crop({ x: 10.5 / 640, y: 0, w: 629.5 / 640, h: 0.5 })];
    expect(frameAfterCrops(ops, { w: 640, h: 360 })).toEqual({ width: 628, height: 180 });
  });

  it("skips crops with an empty time range and non-crop operations", () => {
    const ops = [
      crop({ x: 0.2, y: 0, w: 0.3, h: 1 }, { startTime: 4, endTime: 2 }),
      { mode: "blur", region: { x: 0, y: 0, w: 0.5, h: 0.5 }, startTime: null, endTime: null },
    ];
    expect(frameAfterCrops(ops, dims)).toEqual({ width: 1280, height: 720 });
  });
});
