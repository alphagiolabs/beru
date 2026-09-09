import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { drawBlurredVideoRegion } from "../src/components/video-preview/draw-blurred-video-region.js";

const ROOT = path.resolve(import.meta.dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

describe("blur preview rendering path", () => {
  it("does not rely on CSS backdrop-filter over the video", () => {
    expect(read("src/components/VideoPreview.jsx")).not.toContain("backdropFilter");
    expect(read("src/components/DelogoLivePreview.jsx")).not.toContain("backdropFilter");
  });

  it("draws the video pixels into a canvas blur preview", () => {
    const preview = read("src/components/video-preview/draw-blurred-video-region.js");
    expect(preview).toContain("ctx.drawImage(");
    expect(preview).toContain("video,");
    expect(preview).toContain("ctx.filter = `blur(");
  });

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
    expect(ctx.drawImage).toHaveBeenCalledWith(video, 60, 25, 120, 85, -5, -5, 30, 21.25);
  });
});
