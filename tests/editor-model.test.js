import { describe, expect, it } from "vitest";
import { createEmptyEditorProject, EditorError } from "../shared/editor-project.js";
import { addAsset, insertClip, layoutTrack } from "../shared/editor-timeline.js";
import {
  appendClipFromAsset,
  canvasForSource,
  formatClock,
  formatTimecode,
  secondsToUs,
  setClipRange,
  splitAtPlayhead,
} from "../src/features/editor/editor-model.js";

const SECOND = 1_000_000;

function withSource(
  project,
  { filename = "a.mp4", durationUs = 10 * SECOND, width = 1920, height = 1080 } = {},
) {
  return addAsset(project, {
    path: `C:/Videos/${filename}`,
    filename,
    sizeBytes: 1,
    mtimeMs: 1,
    metadata: { durationUs, width, height, hasAudio: true },
  });
}

const order = (project) => layoutTrack(project).map((e) => e.clip.assetId);

describe("time and canvas helpers", () => {
  it("converts seconds to whole microseconds without drift", () => {
    expect(secondsToUs(1.1)).toBe(1_100_000);
    expect(secondsToUs(0.000001)).toBe(1);
  });

  it("formats clock values for the transport", () => {
    expect(formatClock(0)).toBe("0:00.00");
    expect(formatClock(75.5)).toBe("1:15.50");
  });

  it("formats the player timecode as hours, minutes, seconds and frames", () => {
    expect(formatTimecode(0, 30)).toBe("00:00:00:00");
    expect(formatTimecode(75.5, 30)).toBe("00:01:15:15");
    expect(formatTimecode(3661 + 29 / 30, 30)).toBe("01:01:01:29");
    expect(formatTimecode(1 / 25, 25)).toBe("00:00:00:01");
  });

  it("keeps the source aspect ratio, even dimensions and a 1920 cap", () => {
    expect(canvasForSource(1920, 1080)).toEqual({ width: 1920, height: 1080 });
    expect(canvasForSource(3840, 2160)).toEqual({ width: 1920, height: 1080 });
    expect(canvasForSource(1080, 1921)).toEqual({ width: 1080, height: 1920 });
    expect(canvasForSource(641, 361)).toEqual({ width: 642, height: 362 });
  });
});

describe("appendClipFromAsset", () => {
  it("adds the whole source at the end of the montage, keeping earlier clips", () => {
    const a = withSource(createEmptyEditorProject(), { filename: "a.mp4" });
    const b = withSource(a.project, { filename: "b.mp4", durationUs: 5 * SECOND });
    const first = appendClipFromAsset(b.project, a.assetId);
    const second = appendClipFromAsset(first, b.assetId);
    expect(order(second)).toEqual([a.assetId, b.assetId]);
    expect(layoutTrack(second).map((e) => [e.startUs, e.endUs])).toEqual([
      [0, 10 * SECOND],
      [10 * SECOND, 15 * SECOND],
    ]);
  });

  it("inserts at an index when one is given", () => {
    const a = withSource(createEmptyEditorProject(), { filename: "a.mp4" });
    const b = withSource(a.project, { filename: "b.mp4" });
    const first = appendClipFromAsset(b.project, a.assetId);
    const inserted = appendClipFromAsset(first, b.assetId, 0);
    expect(order(inserted)).toEqual([b.assetId, a.assetId]);
  });

  it("takes the canvas from the first source only while the montage is empty", () => {
    const a = withSource(createEmptyEditorProject(), { width: 1280, height: 720 });
    const b = withSource(a.project, { filename: "b.mp4", width: 640, height: 360 });
    const started = appendClipFromAsset(b.project, a.assetId);
    expect(started.canvas).toMatchObject({ width: 1280, height: 720 });
    const later = appendClipFromAsset(started, b.assetId);
    expect(later.canvas).toEqual(started.canvas);
  });

  it("refuses a source whose duration is unknown", () => {
    const added = withSource(createEmptyEditorProject(), { durationUs: null });
    expect(() => appendClipFromAsset(added.project, added.assetId)).toThrow(/duración conocida/);
  });
});

describe("setClipRange", () => {
  it("writes the requested range as microseconds on the clip", () => {
    const added = withSource(createEmptyEditorProject());
    const base = insertClip(added.project, { assetId: added.assetId }).project;
    const clipId = layoutTrack(base)[0].clip.id;
    const ranged = setClipRange(base, clipId, 1, 6);
    expect(layoutTrack(ranged)[0].clip).toMatchObject({
      sourceInUs: SECOND,
      sourceOutUs: 6 * SECOND,
    });
  });

  it("rejects an out point past the source end with the document's message", () => {
    const added = withSource(createEmptyEditorProject());
    const base = insertClip(added.project, { assetId: added.assetId }).project;
    const clipId = layoutTrack(base)[0].clip.id;
    expect(() => setClipRange(base, clipId, 0, 11)).toThrow(EditorError);
    expect(() => setClipRange(base, clipId, 0, 11)).toThrow(/supera la duración/);
  });
});

describe("splitAtPlayhead", () => {
  function oneClip() {
    const a = withSource(createEmptyEditorProject(), { filename: "a.mp4" });
    return appendClipFromAsset(a.project, a.assetId);
  }

  it("splits the clip strictly under the playhead and returns both halves", () => {
    const project = oneClip();
    const split = splitAtPlayhead(project, 3 * SECOND);
    expect(layoutTrack(split.project).map((e) => [e.startUs, e.endUs])).toEqual([
      [0, 3 * SECOND],
      [3 * SECOND, 10 * SECOND],
    ]);
    expect(split.leftId).not.toBe(split.rightId);
  });

  it("does nothing on a clip edge, where one half would be empty", () => {
    const project = oneClip();
    expect(splitAtPlayhead(project, 0)).toBeNull();
    expect(splitAtPlayhead(project, 10 * SECOND)).toBeNull();
  });

  it("does nothing when no clip is under the playhead", () => {
    expect(splitAtPlayhead(createEmptyEditorProject(), 0)).toBeNull();
  });
});
