import { expect, it } from "vitest";
import { createEmptyEditorProject } from "../shared/editor-project.js";
import {
  addAsset,
  insertClip,
  setClipSpeed,
  setClipMuted,
  setClipTransform,
  layoutTrack,
  projectDurationUs,
} from "../shared/editor-timeline.js";
import { compositionDuration, parseCompositionDocument } from "../shared/composition-document.js";
import { validateCompositionJob } from "../shared/composition-settings.js";
import {
  buildCompositionManifest,
  buildExactFrameManifest,
  compileEditorComposition,
} from "../src/features/editor/composition.js";
import { compositionJob } from "../src/utils/composition.js";

function projectWithClip() {
  const added = addAsset(createEmptyEditorProject(), {
    path: "C:/Videos/a.mp4",
    filename: "a.mp4",
    sizeBytes: 2048,
    mtimeMs: 1700000000000,
    metadata: { width: 640, height: 360, durationUs: 10e6 },
  });
  return insertClip(added.project, { assetId: added.assetId, sourceInUs: 1e6, sourceOutUs: 6e6 })
    .project;
}

it("compiles Editor through the same document and job builder as main's composition", () => {
  const project = projectWithClip(),
    id = project.clips[0].id;
  const edited = setClipTransform(setClipMuted(setClipSpeed(project, id, 2), id, true), id, {
    rotate: 270,
    fit: "fill",
    zoom: 2,
  });
  const document = compileEditorComposition(edited);
  expect(document.type).toBe("beru-composition");
  expect(document.entries[0].item).toMatchObject({
    trimStart: 1,
    trimEnd: 6,
    timing: { rate: 2, repeatCount: 1 },
    audio: { muted: true },
    transform: { rotation: 270 },
    framing: { fit: "cover", zoom: 2 },
  });
  expect(parseCompositionDocument(JSON.parse(JSON.stringify(document)))).toEqual(document);
  const manifest = buildCompositionManifest(edited, { encodeProfile: "quality" });
  expect(manifest.type).toBe("beru-job-manifest");
  expect(manifest.jobs).toEqual([
    compositionJob(document, { outputPath: null, encodeProfile: "quality" }),
  ]);
  expect(manifest.jobs[0].clips[0]).toMatchObject({
    trim_start: 1,
    trim_end: 6,
    playback_rate: 2,
    audio_muted: true,
    rotation: 270,
    source_identity: { sizeBytes: 2048, mtimeMs: 1700000000000 },
  });
  expect(validateCompositionJob(manifest.jobs[0])).toBeNull();
});

it("uses the same job for exact frames and rejects an instant outside its duration", () => {
  const manifest = buildExactFrameManifest(projectWithClip(), 1_500_000);
  expect(manifest.jobs[0].frame).toEqual({ atUs: 1_500_000 });
  expect(validateCompositionJob(manifest.jobs[0])).toBeNull();
  for (const atUs of [-1, 5e6]) {
    expect(validateCompositionJob({ ...manifest.jobs[0], frame: { atUs } })).toMatch(
      /fuera del montaje/,
    );
  }
});

it.each([
  { speed: 1.5, durationUs: 1e6, count: 2, fps: { num: 30, den: 1 }, framesPerClip: 20 },
  { speed: 0.75, durationUs: 2e6, count: 2, fps: { num: 30, den: 1 }, framesPerClip: 80 },
  { speed: 3, durationUs: 1e6, count: 50, fps: { num: 30, den: 1 }, framesPerClip: 10 },
  { speed: 1.5, durationUs: 1e6, count: 50, fps: { num: 30000, den: 1001 }, framesPerClip: 20 },
])(
  "keeps retimed clip boundaries and the last exact frame aligned with the render: %j",
  ({ speed, durationUs, count, fps, framesPerClip }) => {
    const added = addAsset(
      { ...createEmptyEditorProject(), fps },
      {
        path: "C:/Videos/retimed.mp4",
        filename: "retimed.mp4",
        sizeBytes: null,
        mtimeMs: null,
        metadata: { width: 320, height: 180, durationUs },
      },
    );
    let project = added.project;
    for (let i = 0; i < count; i++) {
      project = insertClip(project, { assetId: added.assetId, speed }).project;
    }
    const frameTimeUs = (framesPerClip * fps.den * 1e6) / fps.num;
    const layout = layoutTrack(project);
    expect(layout.map(({ startUs, endUs }) => [startUs, endUs])).toEqual(
      Array.from({ length: count }, (_, i) => [
        Math.round(i * frameTimeUs),
        Math.round((i + 1) * frameTimeUs),
      ]),
    );
    const endUs = projectDurationUs(project);
    expect(endUs).toBe(Math.round(compositionDuration(compileEditorComposition(project)) * 1e6));
    expect(validateCompositionJob(buildExactFrameManifest(project, endUs - 1).jobs[0])).toBeNull();
  },
);

it("builds no jobs for an empty composition", () => {
  expect(buildCompositionManifest(createEmptyEditorProject()).jobs).toEqual([]);
});
