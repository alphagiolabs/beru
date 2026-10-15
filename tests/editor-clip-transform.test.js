import { describe, expect, it } from "vitest";
import {
  DEFAULT_CLIP_TRANSFORM,
  normalizeClipTransform,
  validateClipSpeed,
  validateClipTransform,
} from "../shared/clip-transform.js";
import { createEmptyEditorProject, EditorError } from "../shared/editor-project.js";
import {
  addAsset,
  insertClip,
  layoutTrack,
  setClipMuted,
  setClipSpeed,
  setClipTransform,
} from "../shared/editor-timeline.js";
import {
  buildCompositionManifest,
  buildExactFrameManifest,
  validateCompositionManifest,
} from "../src/features/editor/composition.js";

const SECOND = 1_000_000;

function oneClip() {
  const added = addAsset(createEmptyEditorProject(), {
    path: "C:/Videos/a.mp4",
    filename: "a.mp4",
    sizeBytes: 10,
    mtimeMs: 5,
    metadata: { width: 640, height: 360, durationUs: 10 * SECOND },
  });
  const project = insertClip(added.project, {
    assetId: added.assetId,
    sourceInUs: 0,
    sourceOutUs: 4 * SECOND,
  }).project;
  return { project, clipId: layoutTrack(project)[0].clip.id };
}

describe("transform and speed validation", () => {
  it("accepts the default transform and rejects out-of-range fields", () => {
    expect(validateClipTransform(DEFAULT_CLIP_TRANSFORM)).toBeNull();
    expect(validateClipTransform({ ...DEFAULT_CLIP_TRANSFORM, rotate: 45 })).toMatch(/rotación/);
    expect(validateClipTransform({ ...DEFAULT_CLIP_TRANSFORM, zoom: 5 })).toMatch(/zoom/);
    expect(validateClipTransform({ ...DEFAULT_CLIP_TRANSFORM, offsetX: 1.5 })).toMatch(
      /desplazamiento/,
    );
    expect(validateClipTransform({ ...DEFAULT_CLIP_TRANSFORM, fit: "stretch" })).toMatch(/ajuste/);
  });

  it("rejects a crop that leaves the source or is too small", () => {
    const crop = (c) =>
      validateClipTransform({ ...DEFAULT_CLIP_TRANSFORM, crop: { x: 0, y: 0, w: 1, h: 1, ...c } });
    expect(crop({ x: 0.6, w: 0.6 })).toMatch(/sale del video/);
    expect(crop({ w: 0.01 })).toMatch(/demasiado pequeño/);
    expect(crop({ x: 0.1, y: 0.1, w: 0.5, h: 0.5 })).toBeNull();
  });

  it("accepts speeds from 0.25x to 4x only", () => {
    expect(validateClipSpeed(0.25)).toBeNull();
    expect(validateClipSpeed(4)).toBeNull();
    expect(validateClipSpeed(0.2)).toMatch(/0,25x y 4x/);
    expect(validateClipSpeed(5)).toMatch(/0,25x y 4x/);
  });

  it("fills missing transform fields from the defaults", () => {
    expect(normalizeClipTransform({ rotate: 90 })).toMatchObject({
      rotate: 90,
      zoom: 1,
      fit: "fit",
    });
    expect(normalizeClipTransform({ crop: { x: 0.2 } }).crop).toEqual({ x: 0.2, y: 0, w: 1, h: 1 });
  });
});

describe("clip speed, mute and transform operations", () => {
  it("a speed change resizes the clip on the timeline and moves the clips after it", () => {
    const { project, clipId } = oneClip();
    const added = addAsset(project, {
      path: "C:/Videos/b.mp4",
      filename: "b.mp4",
      metadata: { width: 640, height: 360, durationUs: 2 * SECOND },
    });
    const withSecond = insertClip(added.project, { assetId: added.assetId }).project;
    const faster = setClipSpeed(withSecond, clipId, 2);
    expect(layoutTrack(faster).map((e) => [e.startUs, e.endUs])).toEqual([
      [0, 2 * SECOND],
      [2 * SECOND, 4 * SECOND],
    ]);
    const slower = setClipSpeed(withSecond, clipId, 0.5);
    expect(layoutTrack(slower)[1].startUs).toBe(8 * SECOND);
  });

  it("refuses a speed outside the range", () => {
    const { project, clipId } = oneClip();
    expect(() => setClipSpeed(project, clipId, 8)).toThrow(EditorError);
  });

  it("toggles mute and merges transform patches without losing other fields", () => {
    const { project, clipId } = oneClip();
    const muted = setClipMuted(project, clipId, true);
    expect(muted.clips[0].muted).toBe(true);
    const rotated = setClipTransform(muted, clipId, { rotate: 90 });
    const flipped = setClipTransform(rotated, clipId, { flipH: true });
    expect(flipped.clips[0].transform).toMatchObject({ rotate: 90, flipH: true, zoom: 1 });
    expect(flipped.clips[0].muted).toBe(true);
  });

  it("rejects an invalid transform before it reaches the document", () => {
    const { project, clipId } = oneClip();
    expect(() => setClipTransform(project, clipId, { zoom: 9 })).toThrow(/zoom/);
  });
});

describe("render manifest contract", () => {
  it("carries speed, mute and transform per clip and validates them", () => {
    const { project, clipId } = oneClip();
    const changed = setClipTransform(
      setClipMuted(setClipSpeed(project, clipId, 2), clipId, true),
      clipId,
      { rotate: 270 },
    );
    const manifest = buildCompositionManifest(changed);
    expect(manifest.jobs[0].clips[0]).toMatchObject({
      playback_rate: 2,
      audio_muted: true,
      rotation: 270,
    });
    expect(validateCompositionManifest(manifest)).toEqual({ valid: true });
  });

  it("builds an exact-frame manifest that asks for one PNG at an instant", () => {
    const { project } = oneClip();
    const manifest = buildExactFrameManifest(project, 1_500_000);
    expect(manifest.jobs[0].frame).toEqual({ atUs: 1_500_000 });
    expect(validateCompositionManifest({ ...manifest, output: { path: "C:/x.png" } })).toEqual({
      valid: true,
    });
    expect(
      validateCompositionManifest({
        ...manifest,
        jobs: [{ ...manifest.jobs[0], frame: { atUs: -1 } }],
      }).valid,
    ).toBe(false);
  });
});
