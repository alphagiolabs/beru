/**
 * Feedback loop for text move/resize interaction.
 *
 * Architecture (after fix):
 * - Shared CSS scale wraps video + overlays + TextRegionFrame (not video alone).
 * - Overlay/frame positions use layout space (offsetWidth via regionToScreen).
 * - Pointer deltas use visual content size (getBoundingClientRect via getContentPx).
 * - Text selection chrome is real DOM handles (no canvas hit-test for text).
 */
import { describe, it, expect } from "vitest";
import {
  contentRect,
  contentRectLayout,
  regionToScreen,
  toVideoCoordsNormalized,
} from "../src/utils/video-utils.js";
import {
  applyMove,
  applyResize,
  pointerDeltaToNorm,
  getContentPx,
} from "../src/utils/region-interaction.js";

/** Mock a video element with letterboxing + optional CSS zoom (scale from 0,0). */
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

describe("text region interaction — coordinate contract", () => {
  const region = { x: 0.25, y: 0.25, w: 0.5, h: 0.25 };

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
    // Video + overlays + frame share transform: scale(zoom). Absolute positions
    // are layout (offset) coords; the parent scale makes them match the picture.
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
    // Visual content is layout * zoom for a full-bleed 16:9 in 16:9 box
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
    // 16:9 inside 800×600 → content height = 800/(16/9)=450, width=800
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

describe("text region interaction — DOM chrome ownership", () => {
  /**
   * Mirrors useCanvas.domChromeActive so canvas + TextRegionFrame never double-paint.
   * Logo text (no template id) must still suppress canvas chrome.
   */
  function domChromeActive({ activeTool, sidebarMode, selectedTemplateRegionId, region }) {
    const regionReady = region && Math.abs(region.w) >= 0.01 && Math.abs(region.h) >= 0.01;
    return (
      !!regionReady &&
      ((sidebarMode === "batch" && selectedTemplateRegionId != null) ||
        (sidebarMode !== "batch" && activeTool === "text"))
    );
  }

  const ready = { x: 0.1, y: 0.1, w: 0.3, h: 0.2 };

  it("suppresses canvas chrome for logo text selection (no template id)", () => {
    expect(
      domChromeActive({
        activeTool: "text",
        sidebarMode: "logo",
        selectedTemplateRegionId: null,
        region: ready,
      }),
    ).toBe(true);
  });

  it("suppresses canvas chrome for selected batch template region", () => {
    expect(
      domChromeActive({
        activeTool: "text",
        sidebarMode: "batch",
        selectedTemplateRegionId: "r1",
        region: ready,
      }),
    ).toBe(true);
  });

  it("keeps canvas chrome while rubber-banding a new batch region (no template selected)", () => {
    expect(
      domChromeActive({
        activeTool: "text",
        sidebarMode: "batch",
        selectedTemplateRegionId: null,
        region: ready,
      }),
    ).toBe(false);
  });

  it("keeps canvas chrome for blur/crop/delogo tools", () => {
    expect(
      domChromeActive({
        activeTool: "blur",
        sidebarMode: "logo",
        selectedTemplateRegionId: null,
        region: ready,
      }),
    ).toBe(false);
  });
});

describe("text region interaction — pure geometry", () => {
  const start = { x: 0.2, y: 0.3, w: 0.4, h: 0.2 };

  it("applyMove shifts and clamps inside 0..1", () => {
    const next = applyMove(start, 0.5, 0.6);
    expect(next.w).toBeCloseTo(0.4, 5);
    expect(next.h).toBeCloseTo(0.2, 5);
    expect(next.x).toBeCloseTo(0.6, 5);
    expect(next.y).toBeCloseTo(0.8, 5);
  });

  it("applyResize br grows from bottom-right", () => {
    const next = applyResize(start, "br", 0.1, 0.05);
    expect(next.x).toBeCloseTo(0.2, 5);
    expect(next.y).toBeCloseTo(0.3, 5);
    expect(next.w).toBeCloseTo(0.5, 5);
    expect(next.h).toBeCloseTo(0.25, 5);
  });

  it("applyResize tl moves origin and shrinks", () => {
    const next = applyResize(start, "tl", 0.05, 0.05);
    expect(next.x).toBeCloseTo(0.25, 5);
    expect(next.y).toBeCloseTo(0.35, 5);
    expect(next.w).toBeCloseTo(0.35, 5);
    expect(next.h).toBeCloseTo(0.15, 5);
  });

  it("applyResize enforces min size from left edge", () => {
    const next = applyResize(start, "ml", 0.9, 0);
    expect(next.w).toBeGreaterThanOrEqual(0.01);
    expect(next.x + next.w).toBeCloseTo(start.x + start.w, 5);
  });

  it("applyResize from left edge works when start x is 0", () => {
    // DOM path uses applyResize directly with explicit start snapshot — no
    // truthy startNx=0 sentinel bug.
    const edge = { x: 0, y: 0.2, w: 0.4, h: 0.3 };
    const next = applyResize(edge, "ml", 0.1, 0);
    expect(next.w).toBeLessThan(edge.w);
    expect(next.x).toBeGreaterThan(0);
  });
});

describe("text region interaction — free-drag delta uses content width", () => {
  function freeDragNormDeltaFullElement(video, pixelDx, pixelDy) {
    const rect = video.getBoundingClientRect();
    return { dx: pixelDx / rect.width, dy: pixelDy / rect.height };
  }

  function contentDragNormDelta(video, pixelDx, pixelDy) {
    const c = getContentPx(video);
    return { dx: pixelDx / c.width, dy: pixelDy / c.height };
  }

  it("pillarboxed video: content-based free-drag is correct", () => {
    const pillar = mockVideo({
      layoutW: 1000,
      layoutH: 400,
      videoW: 1920,
      videoH: 1080,
      zoom: 1,
    });
    // 16:9 in 2.5:1 → pillarbox sides
    const c = getContentPx(pillar);
    expect(c.height).toBeCloseTo(400, 5);
    expect(c.width).toBeCloseTo(400 * (1920 / 1080), 5);

    const pixelDx = c.width * 0.1;
    const freeWrong = freeDragNormDeltaFullElement(pillar, pixelDx, 0);
    const correct = contentDragNormDelta(pillar, pixelDx, 0);

    expect(correct.dx).toBeCloseTo(0.1, 5);
    // Full-element width under-reports — production must use content path.
    expect(freeWrong.dx).not.toBeCloseTo(correct.dx, 5);
    expect(correct.dx).toBeGreaterThan(freeWrong.dx);
  });
});
