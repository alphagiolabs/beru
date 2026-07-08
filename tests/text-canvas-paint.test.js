import { describe, it, expect, vi } from "vitest";
import { drawRegionOnCanvas } from "../src/utils/video-utils.js";

function mockCtx() {
  return {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    setLineDash: vi.fn(),
    imageSmoothingEnabled: true,
    imageSmoothingQuality: "high",
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
  };
}

function mockCanvas(ctx) {
  return {
    getContext: () => ctx,
    width: 640,
    height: 360,
    clientWidth: 640,
    clientHeight: 360,
  };
}

function mockVideo() {
  return {
    offsetWidth: 640,
    offsetHeight: 360,
    videoWidth: 1920,
    videoHeight: 1080,
    clientWidth: 640,
    clientHeight: 360,
  };
}

describe("drawRegionOnCanvas text tool", () => {
  it("does not paint a translucent fill that would cover the text preview", () => {
    const ctx = mockCtx();
    const canvas = mockCanvas(ctx);
    const video = mockVideo();
    drawRegionOnCanvas(canvas, video, { x: 0.1, y: 0.1, w: 0.3, h: 0.2 }, "text");

    // Text mode: outline only (strokeRect), never the cyan fillRect body paint
    const fillCalls = ctx.fillRect.mock.calls;
    // clearRect may use fill-like path via clearRect only — fillRect should not paint region body
    // (handle dots also use fillRect — text mode must skip handles entirely)
    expect(fillCalls.length).toBe(0);
    expect(ctx.strokeRect).toHaveBeenCalled();
    expect(ctx.setLineDash).toHaveBeenCalled();
  });

  it("still paints fill for blur/default tools", () => {
    const ctx = mockCtx();
    const canvas = mockCanvas(ctx);
    const video = mockVideo();
    drawRegionOnCanvas(canvas, video, { x: 0.1, y: 0.1, w: 0.3, h: 0.2 }, "blur");
    expect(ctx.fillRect.mock.calls.length).toBeGreaterThan(0);
  });
});
