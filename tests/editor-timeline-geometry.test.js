import { describe, expect, it } from "vitest";
import {
  MIN_CLIP_US,
  clampZoom,
  dropIndex,
  fitPxPerSecond,
  isInView,
  overlayWindow,
  pxToUs,
  snapCandidates,
  snapTime,
  trimmedWindow,
  usToPx,
} from "../src/features/editor/timeline/geometry.js";
import { createEmptyEditorProject } from "../shared/editor-project.js";
import { addAsset, layoutTrack, moveClip } from "../shared/editor-timeline.js";
import { appendClipFromAsset } from "../src/features/editor/editor-model.js";

const SECOND = 1_000_000;

function montage(durationsS) {
  let project = createEmptyEditorProject();
  const ids = durationsS.map((seconds, i) => {
    const added = addAsset(project, {
      path: `C:/Videos/${i}.mp4`,
      filename: `${i}.mp4`,
      metadata: { durationUs: seconds * SECOND },
    });
    project = appendClipFromAsset(added.project, added.assetId);
    return added.assetId;
  });
  return { project, ids };
}

describe("px and time conversions", () => {
  it("round-trips time through pixels at a given zoom", () => {
    expect(usToPx(2 * SECOND, 40)).toBe(80);
    expect(pxToUs(80, 40)).toBe(2 * SECOND);
    expect(pxToUs(usToPx(1_234_567, 13), 13)).toBeCloseTo(1_234_567, -1);
  });

  it("keeps zoom within its bounds", () => {
    expect(clampZoom(0.1)).toBe(2);
    expect(clampZoom(9_999)).toBe(480);
  });

  it("fits the whole montage into the viewport width", () => {
    expect(fitPxPerSecond(10 * SECOND, 500)).toBe(50);
    expect(fitPxPerSecond(0, 500)).toBe(40);
  });
});

describe("snapping", () => {
  it("snaps to the nearest candidate within the threshold and leaves the rest alone", () => {
    const pxPerSecond = 100;
    expect(snapTime(2_030_000, [2 * SECOND, 5 * SECOND], pxPerSecond)).toBe(2 * SECOND);
    expect(snapTime(3 * SECOND, [2 * SECOND, 5 * SECOND], pxPerSecond)).toBe(3 * SECOND);
  });

  it("snaps to clip boundaries and the playhead, never to the dragged clip itself", () => {
    const { project } = montage([4, 4]);
    const layout = layoutTrack(project);
    const candidates = snapCandidates(layout, 6 * SECOND, layout[0].clip.id);
    expect(candidates).toEqual(expect.arrayContaining([0, 6 * SECOND, 4 * SECOND, 8 * SECOND]));
  });
});

describe("reordering", () => {
  it("picks the index the move operation needs: the clips whose midpoint the drop passes", () => {
    const { project, ids } = montage([4, 4, 4]);
    const layout = layoutTrack(project);
    const dragged = layout[0].clip.id;
    const index = dropIndex(layout, 9 * SECOND, dragged);
    expect(index).toBe(1);
    const moved = moveClip(project, dragged, index);
    expect(layoutTrack(moved).map((e) => e.clip.assetId)).toEqual([ids[1], ids[0], ids[2]]);
  });

  it("does not let a long dragged clip shift the midpoints it is compared with", () => {
    const { project } = montage([20, 2, 2]);
    const layout = layoutTrack(project);
    expect(dropIndex(layout, 20.5 * SECOND, layout[0].clip.id)).toBe(0);
    expect(dropIndex(layout, 21.5 * SECOND, layout[0].clip.id)).toBe(1);
  });
});

describe("trimming", () => {
  const clip = { sourceInUs: 1 * SECOND, sourceOutUs: 5 * SECOND, speed: 1 };

  it("moves the in point by the dragged amount and clamps it to the source", () => {
    expect(trimmedWindow(clip, "start", 0.5 * SECOND, 10 * SECOND)).toEqual({
      sourceInUs: 1.5 * SECOND,
      sourceOutUs: 5 * SECOND,
    });
    expect(trimmedWindow(clip, "start", -5 * SECOND, 10 * SECOND).sourceInUs).toBe(0);
  });

  it("keeps the clip at least one frame long", () => {
    const window = trimmedWindow(clip, "start", 10 * SECOND, 10 * SECOND);
    expect(window.sourceOutUs - window.sourceInUs).toBe(MIN_CLIP_US);
  });

  it("moves the out point and never past the source end", () => {
    expect(trimmedWindow(clip, "end", 2 * SECOND, 10 * SECOND).sourceOutUs).toBe(7 * SECOND);
    expect(trimmedWindow(clip, "end", 50 * SECOND, 10 * SECOND).sourceOutUs).toBe(10 * SECOND);
    expect(trimmedWindow(clip, "end", 50 * SECOND, null).sourceOutUs).toBe(55 * SECOND);
  });
});

describe("viewport culling", () => {
  it("includes spans near the viewport and excludes far ones", () => {
    expect(isInView(100, 200, 0, 500)).toBe(true);
    expect(isInView(3000, 3100, 0, 500)).toBe(false);
    expect(isInView(3000, 3100, 2900, 500)).toBe(true);
  });
});

describe("overlayWindow", () => {
  const overlay = { startUs: 2 * SECOND, endUs: 5 * SECOND };

  it("moves the whole interval and keeps its length, never before zero", () => {
    expect(overlayWindow(overlay, "move", SECOND)).toEqual({
      startUs: 3 * SECOND,
      endUs: 6 * SECOND,
    });
    expect(overlayWindow(overlay, "move", -9 * SECOND)).toEqual({ startUs: 0, endUs: 3 * SECOND });
  });

  it("trims one edge and keeps a minimum length", () => {
    expect(overlayWindow(overlay, "start", SECOND)).toEqual({
      startUs: 3 * SECOND,
      endUs: 5 * SECOND,
    });
    expect(overlayWindow(overlay, "start", 9 * SECOND).startUs).toBe(5 * SECOND - MIN_CLIP_US);
    expect(overlayWindow(overlay, "end", -9 * SECOND).endUs).toBe(2 * SECOND + MIN_CLIP_US);
  });

  it("lets the edge snap to a nearby point", () => {
    const snap = (us) => (Math.abs(us - 4 * SECOND) < 100_000 ? 4 * SECOND : us);
    expect(overlayWindow(overlay, "end", -950_000, snap).endUs).toBe(4 * SECOND);
  });
});
