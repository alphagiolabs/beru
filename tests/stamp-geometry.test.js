import { describe, expect, it } from "vitest";
import {
  fitStampsToOutput,
  fitOutputStage,
  itemOutputGeometry,
  outputRegionOnSource,
  outputStageLayer,
  showsOutputFrame,
  sourceRegionToOutput,
} from "../src/utils/stamp-geometry.js";

const item = (transform, operations = []) => ({
  width: 640,
  height: 480,
  operations,
  transform,
});
const region = { x: 0.25, y: 0.1, w: 0.5, h: 0.2 };
const close = (a, b) => ["x", "y", "w", "h"].forEach((k) => expect(a[k]).toBeCloseTo(b[k], 6));

describe("outputRegionOnSource", () => {
  it("is the identity without a transform", () => {
    close(outputRegionOnSource(region, itemOutputGeometry(item())).rect, region);
  });

  it("follows the black bars when padding 4:3 into 16:9", () => {
    const geo = itemOutputGeometry(item({ outputWidth: 1280, outputHeight: 720, fitMode: "pad" }));
    const { rect } = outputRegionOnSource({ x: 0.125, y: 0, w: 0.75, h: 1 }, geo);
    close(rect, { x: 0, y: 0, w: 1, h: 1 });
  });

  it("maps through crops and a cropping fit", () => {
    const crop = { mode: "crop", region: { x: 0.5, y: 0, w: 0.5, h: 1 } };
    const geo = itemOutputGeometry(
      item({ outputWidth: 320, outputHeight: 320, fitMode: "crop" }, [crop]),
    );
    const { rect } = outputRegionOnSource({ x: 0, y: 0, w: 1, h: 1 }, geo);
    close(rect, { x: 0.5, y: 80 / 480, w: 0.5, h: 320 / 480 });
  });

  it("turns the upright box back for rotations and flips", () => {
    const geo = itemOutputGeometry(item({ rotation: 90, flipH: true }));
    const placed = outputRegionOnSource(region, geo);
    expect(placed.quarterTurns).toBe(1);
    expect(placed.cssTransform).toBe("rotate(-90deg) scale(-1, 1)");
    expect(placed.rect.w).toBeCloseTo(region.h, 6);
    expect(placed.rect.h).toBeCloseTo(region.w, 6);
  });

  it.each([
    [{}],
    [{ rotation: 90 }],
    [{ rotation: 180, flipV: true }],
    [{ rotation: 270, flipH: true }],
    [{ outputWidth: 1280, outputHeight: 720, fitMode: "pad" }],
    [{ outputWidth: 500, outputHeight: 500, fitMode: "crop", rotation: 90 }],
    [{ outputWidth: 1920, outputHeight: 1080, fitMode: "stretch", flipH: true }],
  ])("round-trips through sourceRegionToOutput for %j", (transform) => {
    const geo = itemOutputGeometry(item(transform));
    close(sourceRegionToOutput(outputRegionOnSource(region, geo).rect, geo), region);
  });
});

describe("fitStampsToOutput", () => {
  const stamp = {
    mode: "datetime",
    region: { x: 0.1, y: 0.05, w: 0.6, h: 0.1 },
    fontSize: 40,
    textScaleX: 2,
    boxBorderWidth: 4,
  };

  it("scales the text with the output height and keeps its box aspect", () => {
    const [next] = fitStampsToOutput(
      [stamp],
      { width: 640, height: 480 },
      { width: 1920, height: 960 },
    );
    expect(next).toMatchObject({ fontSize: 80, textScaleX: 2, boxBorderWidth: 8 });
    expect(next.region.h).toBe(0.1);
    expect(next.region.w * 1920).toBeCloseTo(0.6 * 640 * 2, 6);
  });

  it("shrinks the stamp to fit a narrower output instead of clipping it", () => {
    const wide = { ...stamp, region: { x: 0.1, y: 0.05, w: 0.62, h: 0.1 } };
    const [next] = fitStampsToOutput(
      [wide],
      { width: 1418, height: 798 },
      { width: 1080, height: 1080 },
    );
    expect(next.region.w).toBeCloseTo(1, 6);
    expect(next.region.x).toBeCloseTo(0, 6);
    expect(next.textScaleX).toBeCloseTo(2, 1);
    const k = 1080 / (0.62 * 1418);
    expect(next.fontSize).toBe(Math.round(40 * k));
    expect(next.region.h * 1080).toBeCloseTo(0.1 * 798 * k, 6);
  });

  it("leaves other operations and unchanged outputs alone", () => {
    const ops = [{ mode: "blur", region }];
    expect(fitStampsToOutput(ops, { width: 1, height: 1 }, { width: 2, height: 2 })).toBe(ops);
    const size = { width: 640, height: 480 };
    expect(fitStampsToOutput([stamp], size, { ...size })).toEqual([stamp]);
  });
});

describe("outputStageLayer", () => {
  const onStage = (layer, x, y) => {
    const [a, b, c, d, e, f] = layer.transform.match(/-?[\d.e+-]+/g).map(Number);
    return [
      a * x * layer.width + c * y * layer.height + e,
      b * x * layer.width + d * y * layer.height + f,
    ];
  };
  const expectPoint = ([x, y], [ex, ey]) => {
    expect(x).toBeCloseTo(ex, 6);
    expect(y).toBeCloseTo(ey, 6);
  };

  it("keeps an untouched video as is", () => {
    const geo = itemOutputGeometry(item());
    expect(showsOutputFrame(geo)).toBe(false);
    const layer = outputStageLayer(geo, fitOutputStage(geo, { width: 640, height: 480 }));
    expect(layer).toMatchObject({ width: 640, height: 480 });
    expectPoint(onStage(layer, 1, 1), [640, 480]);
  });

  it("stretches the live frame exactly like the export", () => {
    const geo = itemOutputGeometry(
      item({ outputWidth: 1280, outputHeight: 720, fitMode: "stretch" }),
    );
    const stage = fitOutputStage(geo, { width: 640, height: 640 });
    expect(stage).toEqual({ width: 640, height: 360 });
    const layer = outputStageLayer(geo, stage);
    expectPoint(onStage(layer, 0, 0), [0, 0]);
    expectPoint(onStage(layer, 1, 1), [640, 360]);
  });

  it("leaves black bars for pad and pushes the crop outside the stage", () => {
    const pad = itemOutputGeometry(item({ outputWidth: 1280, outputHeight: 720, fitMode: "pad" }));
    const padLayer = outputStageLayer(pad, { width: 1280, height: 720 });
    expectPoint(onStage(padLayer, 0, 0), [160, 0]);
    expectPoint(onStage(padLayer, 1, 1), [1120, 720]);

    const cropOp = { mode: "crop", region: { x: 0.5, y: 0, w: 0.5, h: 1 } };
    const crop = itemOutputGeometry(item(undefined, [cropOp]));
    expect(showsOutputFrame(crop)).toBe(true);
    const cropLayer = outputStageLayer(crop, { width: 320, height: 480 });
    expectPoint(onStage(cropLayer, 0.5, 0), [0, 0]);
    expectPoint(onStage(cropLayer, 1, 1), [320, 480]);
  });

  it("rotates and flips the frame onto the stage", () => {
    const geo = itemOutputGeometry(item({ rotation: 90, flipH: true }));
    const layer = outputStageLayer(geo, { width: 480, height: 640 });
    expectPoint(onStage(layer, 0, 0), [0, 0]);
    expectPoint(onStage(layer, 1, 0), [0, 640]);
    expectPoint(onStage(layer, 0, 1), [480, 0]);
  });
});
