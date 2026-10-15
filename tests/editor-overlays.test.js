import { describe, expect, it } from "vitest";
import {
  createEmptyEditorProject,
  EditorError,
  validateEditorProject,
} from "../shared/editor-project.js";
import {
  addAsset,
  addImageOverlay,
  addTextOverlay,
  insertClip,
  overlaysAt,
  removeOverlay,
  updateOverlay,
} from "../shared/editor-timeline.js";
import {
  buildCompositionManifest,
  validateCompositionManifest,
} from "../src/features/editor/composition.js";
import {
  DEFAULT_OVERLAY_STYLE,
  OVERLAY_MAX_COUNT,
  OVERLAY_TEXT_MAX_LENGTH,
} from "../shared/overlay-style.js";

const SECOND = 1_000_000;

function montage() {
  const video = addAsset(createEmptyEditorProject(), {
    path: "C:/Videos/a.mp4",
    filename: "a.mp4",
    sizeBytes: 10,
    mtimeMs: 5,
    metadata: { durationUs: 10 * SECOND, width: 1920, height: 1080 },
  });
  const image = addAsset(video.project, {
    path: "C:/Images/logo.png",
    filename: "logo.png",
    sizeBytes: 64,
    mtimeMs: 7,
    metadata: { durationUs: null, width: 40, height: 40 },
  });
  const project = insertClip(image.project, {
    assetId: video.assetId,
    sourceOutUs: 4 * SECOND,
  }).project;
  return { project, videoId: video.assetId, imageId: image.assetId };
}

describe("title and image layer operations", () => {
  it("adds a title with the default style and a three-second span", () => {
    const { project } = montage();
    const added = addTextOverlay(project, { startUs: SECOND, text: "Hola" });
    const overlay = added.project.overlays.find((o) => o.id === added.overlayId);
    expect(overlay).toMatchObject({
      kind: "text",
      startUs: SECOND,
      endUs: 4 * SECOND,
      text: "Hola",
      style: DEFAULT_OVERLAY_STYLE,
    });
    expect(validateEditorProject(added.project)).toEqual({ valid: true });
  });

  it("layers only still images, never a video asset", () => {
    const { project, videoId, imageId } = montage();
    expect(() => addImageOverlay(project, { assetId: videoId, startUs: 0 })).toThrow(EditorError);
    const layered = addImageOverlay(project, { assetId: imageId, startUs: 0 });
    expect(layered.project.overlays[0]).toMatchObject({ kind: "image", assetId: imageId });
  });

  it("shows an overlay on [startUs, endUs) of the montage clock", () => {
    const { project } = montage();
    const { project: withTitle } = addTextOverlay(project, { startUs: SECOND, text: "T" });
    expect(overlaysAt(withTitle, SECOND - 1)).toHaveLength(0);
    expect(overlaysAt(withTitle, SECOND)).toHaveLength(1);
    expect(overlaysAt(withTitle, 4 * SECOND - 1)).toHaveLength(1);
    expect(overlaysAt(withTitle, 4 * SECOND)).toHaveLength(0);
  });

  it("merges style and box patches and leaves the kind and text alone", () => {
    const { project } = montage();
    const { project: withTitle, overlayId } = addTextOverlay(project, { startUs: 0, text: "T" });
    const restyled = updateOverlay(withTitle, overlayId, {
      style: { size: 0.1 },
      geometry: { y: 0.1 },
    });
    const overlay = restyled.overlays[0];
    expect(overlay.style).toMatchObject({ color: "#ffffff", size: 0.1 });
    expect(overlay.geometry).toEqual({ x: 0.1, y: 0.1, w: 0.8, h: 0.2 });
    expect(overlay.kind).toBe("text");
  });

  it("refuses an edit that leaves the document invalid", () => {
    const { project } = montage();
    const { project: withTitle, overlayId } = addTextOverlay(project, { startUs: 0, text: "T" });
    expect(() => updateOverlay(withTitle, overlayId, { style: { size: 0.9 } })).toThrow(/tamaño/);
    expect(() => updateOverlay(withTitle, overlayId, { text: "   " })).toThrow(/vacío/);
    expect(() => updateOverlay(withTitle, overlayId, { endUs: 0 })).toThrow(/[Ii]ntervalo/);
  });

  it("removes one overlay and reports an unknown id", () => {
    const { project } = montage();
    const { project: withTitle, overlayId } = addTextOverlay(project, { startUs: 0, text: "T" });
    expect(removeOverlay(withTitle, overlayId).overlays).toEqual([]);
    expect(() => removeOverlay(withTitle, "missing")).toThrow(/inexistente/);
  });

  it("caps the number of overlays", () => {
    let project = montage().project;
    for (let i = 0; i < OVERLAY_MAX_COUNT; i += 1) {
      project = addTextOverlay(project, { startUs: 0, text: `t${i}` }).project;
    }
    expect(() => addTextOverlay(project, { startUs: 0, text: "one too many" })).toThrow(
      EditorError,
    );
  });

  it("refuses a title longer than the limit", () => {
    const { project } = montage();
    const text = "x".repeat(OVERLAY_TEXT_MAX_LENGTH + 1);
    expect(() => addTextOverlay(project, { startUs: 0, text })).toThrow(/supera 500 caracteres/);
  });
});

describe("overlays in the render manifest", () => {
  it("carries a title's text and style, and an image's file identity", () => {
    const { project, imageId } = montage();
    const withTitle = addTextOverlay(project, { startUs: 0, text: "Titulo" }).project;
    const withLogo = addImageOverlay(withTitle, { assetId: imageId, startUs: SECOND }).project;
    const manifest = buildCompositionManifest(withLogo);
    expect(manifest.jobs[0].overlays).toEqual([
      expect.objectContaining({
        kind: "text",
        text: "Titulo",
        style: DEFAULT_OVERLAY_STYLE,
        startUs: 0,
        endUs: 3 * SECOND,
      }),
      expect.objectContaining({
        kind: "image",
        startUs: SECOND,
        source: { path: "C:/Images/logo.png", sizeBytes: 64, mtimeMs: 7 },
      }),
    ]);
    expect(validateCompositionManifest(manifest)).toEqual({ valid: true });
  });

  it("accepts the common job contract without global layers", () => {
    const { project } = montage();
    const legacy = buildCompositionManifest(project);
    delete legacy.jobs[0].overlays;
    expect(validateCompositionManifest(legacy)).toEqual({ valid: true });
  });

  it("rejects overlays the renderer would refuse", () => {
    const { project, imageId } = montage();
    const withLogo = addImageOverlay(project, { assetId: imageId, startUs: 0 }).project;
    const base = buildCompositionManifest(withLogo);
    const [image] = base.jobs[0].overlays;
    const cases = [
      [{ ...image, source: { path: "logo.png" } }, /absoluta/],
      [{ ...image, geometry: { x: 0.9, y: 0, w: 0.5, h: 0.2 } }, /fuera del lienzo/],
      [{ ...image, endUs: image.startUs }, /[Ii]ntervalo/],
      [{ ...image, kind: "video" }, /[Tt]ipo.*inválid/],
    ];
    for (const [overlay, pattern] of cases) {
      const result = validateCompositionManifest({
        ...base,
        jobs: [{ ...base.jobs[0], overlays: [overlay] }],
      });
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(pattern);
    }
    const text = {
      id: "t",
      kind: "text",
      startUs: 0,
      endUs: SECOND,
      geometry: { x: 0, y: 0, w: 1, h: 0.2 },
      text: "Hola",
      style: { color: "red", size: 0.1 },
    };
    expect(
      validateCompositionManifest({ ...base, jobs: [{ ...base.jobs[0], overlays: [text] }] }).error,
    ).toMatch(/#rrggbb/);
    const overfull = Array.from({ length: OVERLAY_MAX_COUNT + 1 }, (_, i) => ({
      ...text,
      id: `t${i}`,
    }));
    expect(
      validateCompositionManifest({ ...base, jobs: [{ ...base.jobs[0], overlays: overfull }] })
        .error,
    ).toMatch(/[Ss]uperposiciones.*rango/);
  });
});

describe("canvas dimensions", () => {
  it("rounds sizes to the common minimum canvas dimension", async () => {
    const { evenDimension } = await import("../src/features/editor/editor-model.js");
    expect(evenDimension(1081)).toBe(1082);
    expect(evenDimension(1080)).toBe(1080);
    expect(evenDimension(0)).toBe(16);
  });

  it("refuses an odd canvas in the document and in the manifest", async () => {
    const { setCanvas } = await import("../shared/editor-timeline.js");
    const { project } = montage();
    expect(() => setCanvas(project, { width: 1281 })).toThrow(/canvas/);
    const manifest = buildCompositionManifest(project);
    expect(
      validateCompositionManifest({
        ...manifest,
        jobs: [{ ...manifest.jobs[0], canvas: { ...manifest.jobs[0].canvas, height: 721 } }],
      }),
    ).toEqual({
      valid: false,
      error: "canvas: las dimensiones deben ser pares",
    });
  });
});
