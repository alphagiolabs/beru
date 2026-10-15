import { describe, expect, it } from "vitest";
import { EditorError, createEmptyEditorProject } from "../shared/editor-project.js";
import {
  activeClipsAt,
  addAsset,
  duplicateClip,
  insertClip,
  layoutTrack,
  moveClip,
  projectDurationUs,
  relinkAsset,
  removeClip,
  setCanvas,
  sourceTimeAt,
  splitClip,
  trimClip,
} from "../shared/editor-timeline.js";

const SECOND = 1_000_000;

const source = (path, durationUs = 8 * SECOND) => ({
  path,
  filename: path.split("/").pop(),
  sizeBytes: 1000,
  mtimeMs: 1700000000000,
  metadata: { durationUs },
});

function withAssets() {
  let project = createEmptyEditorProject();
  const a = addAsset(project, source("C:/Videos/a.mp4"));
  const b = addAsset(a.project, source("C:/Videos/b.mp4", 5 * SECOND));
  return { project: b.project, a: a.assetId, b: b.assetId };
}

const clipOrder = (project) => layoutTrack(project).map((e) => e.clip.id);

describe("addAsset", () => {
  it("reuses one asset when the same file is referenced again, ignoring case and slashes", () => {
    const first = addAsset(createEmptyEditorProject(), source("C:/Videos/a.mp4"));
    const again = addAsset(first.project, source("c:\\videos\\A.MP4"));
    expect(again.assetId).toBe(first.assetId);
    expect(again.project.assets).toHaveLength(1);
  });
});

describe("insertClip and derived layout", () => {
  it("appends a full-length clip by default and derives its start from the order", () => {
    const { project, a, b } = withAssets();
    const first = insertClip(project, { assetId: a, sourceOutUs: 3 * SECOND });
    const second = insertClip(first.project, { assetId: b });
    expect(layoutTrack(second.project).map((e) => [e.clip.assetId, e.startUs, e.endUs])).toEqual([
      [a, 0, 3 * SECOND],
      [b, 3 * SECOND, 8 * SECOND],
    ]);
  });

  it("inserts at an index and shifts the following clips", () => {
    const { project, a, b } = withAssets();
    const first = insertClip(project, { assetId: a, sourceOutUs: 2 * SECOND });
    const second = insertClip(first.project, { assetId: b, index: 0, sourceOutUs: 1 * SECOND });
    expect(clipOrder(second.project)).toEqual([second.clipId, first.clipId]);
    expect(layoutTrack(second.project)[1].startUs).toBe(1 * SECOND);
  });

  it("refuses a source with unknown duration and no explicit out point", () => {
    const project = addAsset(createEmptyEditorProject(), source("C:/Videos/x.mp4", null)).project;
    const assetId = project.assets[0].id;
    expect(() => insertClip(project, { assetId })).toThrow(EditorError);
  });

  it("refuses an out point past the end of the source", () => {
    const { project, b } = withAssets();
    expect(() => insertClip(project, { assetId: b, sourceOutUs: 6 * SECOND })).toThrow(
      /supera la duración/,
    );
  });
});

describe("trimClip", () => {
  it("ripples the following clips when the first clip is shortened", () => {
    const { project, a, b } = withAssets();
    const first = insertClip(project, { assetId: a, sourceOutUs: 4 * SECOND });
    const second = insertClip(first.project, { assetId: b, sourceOutUs: 2 * SECOND });
    const trimmed = trimClip(second.project, first.clipId, { sourceInUs: 1 * SECOND });
    expect(layoutTrack(trimmed).map((e) => [e.startUs, e.endUs])).toEqual([
      [0, 3 * SECOND],
      [3 * SECOND, 5 * SECOND],
    ]);
  });
});

describe("splitClip", () => {
  it("creates two clips with new ids that keep the asset and remap the source interval", () => {
    const { project, a } = withAssets();
    const base = insertClip(project, {
      assetId: a,
      sourceInUs: 1 * SECOND,
      sourceOutUs: 6 * SECOND,
    });
    const split = splitClip(base.project, base.clipId, 2 * SECOND);
    const [left, right] = layoutTrack(split.project).map((e) => e.clip);
    expect([left.id, right.id]).toEqual([split.leftId, split.rightId]);
    expect(split.leftId).not.toBe(base.clipId);
    expect([left.assetId, right.assetId]).toEqual([a, a]);
    expect([left.sourceInUs, left.sourceOutUs]).toEqual([1 * SECOND, 3 * SECOND]);
    expect([right.sourceInUs, right.sourceOutUs]).toEqual([3 * SECOND, 6 * SECOND]);
    expect(projectDurationUs(split.project)).toBe(5 * SECOND);
    expect(split.project.assets).toHaveLength(2);
  });

  it("rejects cuts on or outside the clip edges", () => {
    const { project, a } = withAssets();
    const base = insertClip(project, { assetId: a, sourceOutUs: 4 * SECOND });
    expect(() => splitClip(base.project, base.clipId, 0)).toThrow(/dentro del clip/);
    expect(() => splitClip(base.project, base.clipId, 4 * SECOND)).toThrow(/dentro del clip/);
  });
});

describe("duplicateClip", () => {
  it("copies the decisions and shares the asset without copying media", () => {
    const { project, a } = withAssets();
    const base = insertClip(project, { assetId: a, sourceOutUs: 2 * SECOND });
    const copy = duplicateClip(base.project, base.clipId);
    expect(clipOrder(copy.project)).toEqual([base.clipId, copy.clipId]);
    const duplicated = copy.project.clips.find((c) => c.id === copy.clipId);
    expect(duplicated).toMatchObject({ assetId: a, sourceInUs: 0, sourceOutUs: 2 * SECOND });
    expect(copy.project.assets).toEqual(project.assets);
    expect(projectDurationUs(copy.project)).toBe(4 * SECOND);
  });
});

describe("removeClip and moveClip", () => {
  it("removes a clip and compacts the timeline", () => {
    const { project, a, b } = withAssets();
    const first = insertClip(project, { assetId: a, sourceOutUs: 3 * SECOND });
    const second = insertClip(first.project, { assetId: b, sourceOutUs: 2 * SECOND });
    const removed = removeClip(second.project, first.clipId);
    expect(layoutTrack(removed)).toEqual([
      expect.objectContaining({ startUs: 0, endUs: 2 * SECOND }),
    ]);
  });

  it("moves a clip and recomputes the order", () => {
    const { project, a, b } = withAssets();
    const first = insertClip(project, { assetId: a, sourceOutUs: 1 * SECOND });
    const second = insertClip(first.project, { assetId: b, sourceOutUs: 1 * SECOND });
    const moved = moveClip(second.project, second.clipId, 0);
    expect(clipOrder(moved)).toEqual([second.clipId, first.clipId]);
  });

  it("rejects a move index outside the track", () => {
    const { project, a } = withAssets();
    const base = insertClip(project, { assetId: a, sourceOutUs: 1 * SECOND });
    expect(() => moveClip(base.project, base.clipId, 1)).toThrow(EditorError);
  });
});

describe("setCanvas", () => {
  it("applies a partial patch", () => {
    const next = setCanvas(createEmptyEditorProject(), { width: 1080, height: 1920 });
    expect(next.canvas).toEqual({ width: 1080, height: 1920, background: "#000000" });
  });

  it("rejects non-positive dimensions", () => {
    expect(() => setCanvas(createEmptyEditorProject(), { width: 0 })).toThrow(EditorError);
  });
});

describe("relinkAsset", () => {
  it("keeps the asset id and every clip reference when the file moves", () => {
    const { project, a } = withAssets();
    const base = insertClip(project, { assetId: a, sourceOutUs: 2 * SECOND });
    const relinked = relinkAsset(base.project, a, source("D:/Rushes/a-moved.mp4"));
    expect(relinked.assets.find((x) => x.id === a).path).toBe("D:/Rushes/a-moved.mp4");
    expect(relinked.clips[0].assetId).toBe(a);
  });

  it("takes the replacement's probed metadata, not only its duration", () => {
    const { project, a } = withAssets();
    const replacement = {
      ...source("D:/Rushes/a-4k.mp4"),
      metadata: { durationUs: 10 * SECOND, width: 3840, height: 2160, hasAudio: false },
    };
    const relinked = relinkAsset(project, a, replacement);
    expect(relinked.assets.find((x) => x.id === a).metadata).toEqual(replacement.metadata);
  });

  it("rejects a relink to a path another asset already uses", () => {
    const { project, a } = withAssets();
    expect(() => relinkAsset(project, a, source("C:/Videos/b.mp4"))).toThrow(/Ya existe un asset/);
  });

  it("rejects a replacement too short to hold the clips that use it", () => {
    const { project, a } = withAssets();
    const base = insertClip(project, { assetId: a, sourceOutUs: 6 * SECOND });
    expect(() => relinkAsset(base.project, a, source("D:/short.mp4", 2 * SECOND))).toThrow(
      /supera la duración/,
    );
  });
});

describe("derived timeline", () => {
  it("returns the clip owning a boundary frame and nothing for the previous one", () => {
    const { project, a, b } = withAssets();
    const first = insertClip(project, { assetId: a, sourceOutUs: 2 * SECOND });
    const second = insertClip(first.project, { assetId: b, sourceOutUs: 2 * SECOND });
    expect(activeClipsAt(second.project, 2 * SECOND - 1).map((e) => e.clip.id)).toEqual([
      first.clipId,
    ]);
    expect(activeClipsAt(second.project, 2 * SECOND).map((e) => e.clip.id)).toEqual([
      second.clipId,
    ]);
    expect(activeClipsAt(second.project, 4 * SECOND)).toEqual([]);
  });

  it("maps project time to source time through the clip's in point and speed", () => {
    const { project, a } = withAssets();
    const base = insertClip(project, {
      assetId: a,
      sourceInUs: 1 * SECOND,
      sourceOutUs: 5 * SECOND,
    });
    const [entry] = layoutTrack(base.project);
    expect(sourceTimeAt(entry, 2 * SECOND)).toBe(3 * SECOND);
  });

  it("includes overlays in the project duration", () => {
    const { project } = withAssets();
    const withOverlay = {
      ...project,
      overlays: [
        {
          id: "ov_1",
          kind: "text",
          text: "t",
          startUs: 0,
          endUs: 9 * SECOND,
          geometry: { x: 0, y: 0, w: 1, h: 1 },
        },
      ],
    };
    expect(projectDurationUs(withOverlay)).toBe(9 * SECOND);
  });
});
