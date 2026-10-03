import { describe, it, expect } from "vitest";
import {
  contentRect,
  contentRectLayout,
  letterboxContent,
  regionToScreen,
  toVideoCoordsNormalized,
} from "../src/utils/video-utils.js";
import { applyResize, pointerDeltaToNorm, getContentPx } from "../src/utils/region-interaction.js";

function mockVideo({
  layoutW,
  layoutH,
  videoW = 1920,
  videoH = 1080,
  zoom = 1,
  clientLeft = 100,
  clientTop = 50,
}) {
  const brW = layoutW * zoom;
  const brH = layoutH * zoom;
  return {
    offsetWidth: layoutW,
    offsetHeight: layoutH,
    videoWidth: videoW,
    videoHeight: videoH,
    clientWidth: layoutW,
    clientHeight: layoutH,
    getBoundingClientRect() {
      return {
        width: brW,
        height: brH,
        left: clientLeft,
        top: clientTop,
        right: clientLeft + brW,
        bottom: clientTop + brH,
        x: clientLeft,
        y: clientTop,
      };
    },
  };
}

describe("letterboxContent", () => {
  it("fills a matching 16:9 container", () => {
    const box = letterboxContent(800, 450, 1920, 1080);
    expect(box.dw).toBeCloseTo(800, 5);
    expect(box.dh).toBeCloseTo(450, 5);
    expect(box.ox).toBeCloseTo(0, 5);
    expect(box.oy).toBeCloseTo(0, 5);
  });

  it("pillarboxes a tall video in a wide container", () => {
    const box = letterboxContent(800, 450, 1080, 1920);
    expect(box.dh).toBeCloseTo(450, 5);
    expect(box.dw).toBeCloseTo(450 * (1080 / 1920), 5);
    expect(box.ox).toBeCloseTo((800 - box.dw) / 2, 5);
    expect(box.oy).toBeCloseTo(0, 5);
  });
});

describe("text region interaction — coordinate contract", () => {
  const region = { x: 0.25, y: 0.25, w: 0.5, h: 0.25 };

  it("preserves fractional CSS dimensions without applying the shared zoom twice", () => {
    const video = document.createElement("video");
    video.style.width = "253.375px";
    video.style.height = "142.5234375px";
    Object.defineProperties(video, {
      offsetWidth: { value: 253 },
      offsetHeight: { value: 143 },
      videoWidth: { value: 320 },
      videoHeight: { value: 180 },
    });
    video.getBoundingClientRect = () => ({ width: 506.75, height: 285.046875 });
    const screen = regionToScreen(region, video);
    expect(screen.x).toBeCloseTo(63.34375, 5);
    expect(screen.w).toBeCloseTo(126.6875, 5);
  });

  it("at zoom=1, layout and visual content rects agree", () => {
    const video = mockVideo({ layoutW: 640, layoutH: 360, zoom: 1 });
    const layout = contentRectLayout(video);
    const visual = contentRect(video);
    expect(layout.dw).toBeCloseTo(visual.dw, 5);
    expect(layout.dh).toBeCloseTo(visual.dh, 5);
    expect(layout.ox).toBeCloseTo(visual.ox, 5);
    expect(layout.oy).toBeCloseTo(visual.oy, 5);
  });

  it("with shared CSS zoom layer, overlays stay in layout space", () => {
    const zoom = 2;
    const video = mockVideo({ layoutW: 640, layoutH: 360, zoom });
    const screen = regionToScreen(region, video);
    const layout = contentRectLayout(video);

    expect(screen).not.toBeNull();
    expect(screen.w).toBeCloseTo(region.w * layout.dw, 5);
    expect(screen.h).toBeCloseTo(region.h * layout.dh, 5);
    expect(screen.x).toBeCloseTo(region.x * layout.dw + layout.ox, 5);
    expect(screen.y).toBeCloseTo(region.y * layout.dh + layout.oy, 5);
  });

  it("pointer deltas use visual content size so zoom is accounted for", () => {
    const zoom = 2;
    const video = mockVideo({ layoutW: 640, layoutH: 360, zoom });
    const content = getContentPx(video);
    expect(content).not.toBeNull();
    expect(content.width).toBeCloseTo(640 * zoom, 5);
    expect(content.height).toBeCloseTo(360 * zoom, 5);

    const { dx, dy } = pointerDeltaToNorm(
      { clientX: 0, clientY: 0 },
      { clientX: content.width * 0.1, clientY: content.height * 0.2 },
      content,
    );
    expect(dx).toBeCloseTo(0.1, 5);
    expect(dy).toBeCloseTo(0.2, 5);
  });

  it("pointer delta → normalized delta uses content (not letterbox bars)", () => {
    const video = mockVideo({
      layoutW: 800,
      layoutH: 600,
      videoW: 1920,
      videoH: 1080,
      zoom: 1,
    });
    const content = getContentPx(video);
    expect(content).not.toBeNull();
    expect(content.width).toBeCloseTo(800, 5);
    expect(content.height).toBeCloseTo(450, 5);

    const { dx, dy } = pointerDeltaToNorm(
      { clientX: 0, clientY: 0 },
      { clientX: content.width * 0.1, clientY: content.height * 0.2 },
      content,
    );
    expect(dx).toBeCloseTo(0.1, 5);
    expect(dy).toBeCloseTo(0.2, 5);
  });

  it("toVideoCoordsNormalized round-trips with contentRect under zoom", () => {
    const zoom = 2;
    const video = mockVideo({ layoutW: 640, layoutH: 360, zoom, clientLeft: 10, clientTop: 20 });
    const c = contentRect(video);
    const cx = c.br.left + c.ox + c.dw / 2;
    const cy = c.br.top + c.oy + c.dh / 2;
    const v = toVideoCoordsNormalized(video, cx, cy);
    expect(v.x).toBeCloseTo(0.5, 5);
    expect(v.y).toBeCloseTo(0.5, 5);
  });
});

describe("text region interaction — pure geometry", () => {
  const start = { x: 0.2, y: 0.3, w: 0.4, h: 0.2 };

  it("applyResize enforces min size from left edge", () => {
    const next = applyResize(start, "ml", 0.9, 0);
    expect(next.w).toBeGreaterThanOrEqual(0.01);
    expect(next.x + next.w).toBeCloseTo(start.x + start.w, 5);
  });

  it("applyResize from left edge works when start x is 0", () => {
    const edge = { x: 0, y: 0.2, w: 0.4, h: 0.3 };
    const next = applyResize(edge, "ml", 0.1, 0);
    expect(next.w).toBeLessThan(edge.w);
    expect(next.x).toBeGreaterThan(0);
  });
});
