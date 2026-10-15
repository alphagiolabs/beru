import { describe, it, expect } from "vitest";
import {
  IDENTITY_TRANSFORM,
  normalizeTransform,
  outputDimensions,
  outputLayout,
  transformJobFields,
} from "../src/utils/output-geometry.js";
import cases from "./fixtures/output-geometry-cases.json";

describe("output geometry — shared cases with the Processor", () => {
  it.each(cases.cases)(
    "frame $frame.width×$frame.height with $transform.rotation° → $expect.width×$expect.height",
    (c) => {
      expect(outputDimensions(c.frame, c.transform)).toEqual(c.expect);
    },
  );

  it.each(cases.layout_cases)(
    "frame $frame.width×$frame.height → $expect.width×$expect.height ($transform.fitMode)",
    (c) => {
      expect(outputLayout(c.frame, c.transform)).toEqual(c.expect);
    },
  );

  it("identity leaves the frame as it is", () => {
    expect(outputDimensions({ width: 640, height: 360 }, IDENTITY_TRANSFORM)).toEqual({
      width: 640,
      height: 360,
      resized: false,
    });
  });

  it("invalid values fall back to identity", () => {
    expect(normalizeTransform({ rotation: 45, outputHeight: -4, flipH: "yes" })).toEqual(
      IDENTITY_TRANSFORM,
    );
  });

  it("maps the transform to the job wire format", () => {
    expect(
      transformJobFields({ rotation: 270, flipH: true, flipV: false, outputHeight: 720 }),
    ).toEqual({
      rotation: 270,
      flip_h: true,
      flip_v: false,
      output_height: 720,
      output_width: null,
      fit_mode: "pad",
    });
    expect(
      transformJobFields({ outputWidth: 1280, outputHeight: 720, fitMode: "stretch" }),
    ).toMatchObject({ output_width: 1280, output_height: 720, fit_mode: "stretch" });
  });

  it("drops a width without a height and keeps explicit sizes within limits", () => {
    expect(normalizeTransform({ outputWidth: 1280 })).toMatchObject({
      outputWidth: null,
      outputHeight: null,
    });
    expect(normalizeTransform({ outputWidth: 8, outputHeight: 4 })).toMatchObject({
      outputWidth: null,
      outputHeight: 4,
    });
    expect(normalizeTransform({ outputWidth: 640, outputHeight: 4 })).toMatchObject({
      outputWidth: 640,
      outputHeight: 16,
    });
  });
});
