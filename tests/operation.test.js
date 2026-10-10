import { describe, it, expect } from "vitest";
import {
  createOperation,
  filterOperationsForExport,
  operationToJobPayload,
  operationsToJobPayload,
} from "../src/utils/operation.js";

describe("createOperation", () => {
  it("fills defaults and applies overrides", () => {
    const op = createOperation({ mode: "text", text: "Hola", fontSize: 40 });
    expect(op.id).toEqual(expect.any(String));
    expect(op.mode).toBe("text");
    expect(op.text).toBe("Hola");
    expect(op.fontSize).toBe(40);
    expect(op.region).toBeNull();
    expect(op.delogoMethod).toBe("blur");
  });
});

describe("operationToJobPayload", () => {
  it("denormalizes region and emits snake_case fields", () => {
    const payload = operationToJobPayload(
      {
        mode: "blur",
        region: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
        blurStrength: 15,
        startTime: 1,
        endTime: 4,
      },
      1920,
      1080,
    );
    expect(payload.mode).toBe("blur");
    expect(payload.region).toEqual({ x: 192, y: 108, w: 384, h: 216 });
    expect(payload.blur_strength).toBe(15);
    expect(payload.start_time).toBe(1);
    expect(payload.end_time).toBe(4);
  });

  it("clamps delogo fields before the Job wire format", () => {
    const payload = operationToJobPayload(
      {
        mode: "delogo",
        region: { x: 0.1, y: 0.1, w: 0.2, h: 0.1 },
        delogoMethod: "invalid-method",
        temporalRadius: 999,
        mosaicSize: -5,
        edgeFeather: 100,
        blurStrength: 0,
      },
      1920,
      1080,
    );
    expect(payload.delogo_method).toBe("blur");
    expect(payload.temporal_radius).toBe(15);
    expect(payload.mosaic_size).toBe(4);
    expect(payload.edge_feather).toBe(40);
    expect(payload.blur_strength).toBe(1);
  });

  it("keeps the region as-is when video size is unknown", () => {
    const region = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };
    const payload = operationToJobPayload({ mode: "crop", region }, 0, 0);
    expect(payload.region).toEqual(region);
  });
});

describe("operationsToJobPayload", () => {
  it("drops blank text and image ops", () => {
    const payloads = operationsToJobPayload(
      [
        { mode: "text", text: "  ", region: { x: 0.1, y: 0.1, w: 0.2, h: 0.1 } },
        { mode: "text", text: "", region: { x: 0.5, y: 0.5, w: 0.2, h: 0.1 } },
        { mode: "text", text: "Hola", region: { x: 0.2, y: 0.2, w: 0.2, h: 0.1 } },
        { mode: "image", imagePath: "", region: { x: 0.3, y: 0.3, w: 0.1, h: 0.1 } },
        { mode: "delogo", region: { x: 0.4, y: 0.4, w: 0.1, h: 0.1 } },
        { mode: "blur", region: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 }, blurStrength: 20 },
      ],
      1000,
      1000,
    );
    expect(payloads.map((op) => op.mode)).toEqual(["text", "delogo", "blur"]);
    expect(payloads[0].text).toBe("Hola");
  });
});

describe("filterOperationsForExport", () => {
  it("returns an empty array for non-array input", () => {
    expect(filterOperationsForExport(null)).toEqual([]);
    expect(filterOperationsForExport(undefined)).toEqual([]);
  });
});
