import { describe, expect, it } from "vitest";
import { createEmptyEditorProject } from "../shared/editor-project.js";
import { addAsset, layoutTrack } from "../shared/editor-timeline.js";
import { appendClipFromAsset, setClipRange } from "../src/features/editor/editor-model.js";
import {
  PRELOAD_LEAD_US,
  decideAdvance,
  entryAt,
  nextEntryAfter,
  preloadTarget,
  projectUsAtSource,
  sourceSecondsAt,
} from "../src/features/editor/playback/scene.js";

const SECOND = 1_000_000;

function montage() {
  let project = createEmptyEditorProject();
  const a = addAsset(project, {
    path: "C:/a.mp4",
    filename: "a.mp4",
    metadata: { durationUs: 10 * SECOND },
  });
  project = appendClipFromAsset(a.project, a.assetId);
  const b = addAsset(project, {
    path: "C:/b.mp4",
    filename: "b.mp4",
    metadata: { durationUs: 8 * SECOND },
  });
  project = appendClipFromAsset(b.project, b.assetId);
  const [first, second] = layoutTrack(project);
  project = setClipRange(project, first.clip.id, 1, 6);
  project = setClipRange(project, second.clip.id, 0, 4);
  const layout = layoutTrack(project);
  return { layout, first: layout[0].clip.id, second: layout[1].clip.id };
}

describe("entryAt", () => {
  it("assigns a boundary frame to the next clip only", () => {
    const { layout, second } = montage();
    expect(entryAt(layout, 5 * SECOND - 1).clip.id).not.toBe(second);
    expect(entryAt(layout, 5 * SECOND).clip.id).toBe(second);
    expect(entryAt(layout, 9 * SECOND)).toBeNull();
  });
});

describe("source and project time", () => {
  it("maps a project time to the source of its clip and back", () => {
    const { layout } = montage();
    const second = layout[1];
    expect(sourceSecondsAt(second, 6 * SECOND)).toBe(1);
    expect(projectUsAtSource(second, 1 * SECOND)).toBe(6 * SECOND);
    expect(projectUsAtSource(layout[0], 6 * SECOND)).toBe(5 * SECOND);
  });
});

describe("decideAdvance", () => {
  it("continues while the active clip still owns the time", () => {
    const { layout, first } = montage();
    expect(decideAdvance(layout, first, 4.99 * SECOND)).toEqual({ kind: "continue" });
  });

  it("hands over at the clip's end, not at the next time update", () => {
    const { layout, first, second } = montage();
    const decision = decideAdvance(layout, first, 5 * SECOND);
    expect(decision.kind).toBe("advance");
    expect(decision.entry.clip.id).toBe(second);
  });

  it("ends the montage after its last clip", () => {
    const { layout, second } = montage();
    expect(decideAdvance(layout, second, 9 * SECOND)).toEqual({ kind: "end" });
  });

  it("ends when the active clip is unknown", () => {
    const { layout } = montage();
    expect(decideAdvance(layout, "missing", 0)).toEqual({ kind: "end" });
  });
});

describe("preloadTarget", () => {
  it("prepares the next clip only inside the lead window", () => {
    const { layout, first, second } = montage();
    const leadStart = 5 * SECOND - PRELOAD_LEAD_US;
    expect(preloadTarget(layout, first, leadStart - 1, null)).toBeNull();
    expect(preloadTarget(layout, first, leadStart, null)?.clip.id).toBe(second);
  });

  it("does not prepare the same clip twice", () => {
    const { layout, first, second } = montage();
    expect(preloadTarget(layout, first, 4 * SECOND, second)).toBeNull();
  });

  it("has nothing to prepare after the last clip", () => {
    const { layout, second } = montage();
    expect(preloadTarget(layout, second, 8 * SECOND, null)).toBeNull();
  });

  it("finds the following clip by order, not by id", () => {
    const { layout, first, second } = montage();
    expect(nextEntryAfter(layout, first).clip.id).toBe(second);
    expect(nextEntryAfter(layout, second)).toBeNull();
  });
});
