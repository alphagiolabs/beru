import { describe, expect, it, vi } from "vitest";
import { drawBlurredVideoRegion } from "../src/components/video-preview/draw-blurred-video-region.js";

describe("blur preview rendering path", () => {
  it("samples beyond the selected box so the blurred edges remain filled", () => {
    let filterAtDraw = "";
    const ctx = {
      filter: "none",
      save: vi.fn(),
      restore: vi.fn(),
      clearRect: vi.fn(),
      drawImage: vi.fn(() => {
        filterAtDraw = ctx.filter;
      }),
    };
    const video = { videoWidth: 320, videoHeight: 180 };
    const region = { x: 0.25, y: 0.25, w: 0.25, h: 0.25 };
    const screen = { w: 20, h: 11.25, sx: 0.25, sy: 0.25 };

    expect(drawBlurredVideoRegion(ctx, video, region, screen, 30)).toBe(true);
    expect(filterAtDraw).toBe("blur(2.5px)");
    expect(ctx.drawImage).toHaveBeenCalledWith(video, 50, 15, 140, 105, -7.5, -7.5, 35, 26.25);
  });

  it("rounds the source origin like the FFmpeg job payload", () => {
    const ctx = {
      filter: "none",
      save() {},
      restore() {},
      clearRect() {},
      drawImage: vi.fn(),
    };
    drawBlurredVideoRegion(
      ctx,
      { videoWidth: 320, videoHeight: 180 },
      { x: 0.255, y: 0.25, w: 0.25, h: 0.25 },
      { w: 20, h: 11.25, sx: 0.25, sy: 0.25 },
      30,
    );
    expect(ctx.drawImage.mock.calls[0][1]).toBe(52);
  });

  it("preserves the requested blur intensity for small selections", () => {
    let filterAtDraw = "";
    const ctx = {
      filter: "none",
      save() {},
      restore() {},
      clearRect() {},
      drawImage() {
        filterAtDraw = ctx.filter;
      },
    };
    drawBlurredVideoRegion(
      ctx,
      { videoWidth: 320, videoHeight: 180 },
      { x: 0.2, y: 0.2, w: 0.1, h: 0.05 },
      { w: 32, h: 9, sx: 1, sy: 1 },
      100,
    );
    expect(filterAtDraw).toBe("blur(33px)");
  });
});
