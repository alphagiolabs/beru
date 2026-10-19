import { describe, expect, it } from "vitest";
import { createEmptyEditorProject, parseEditorProject } from "../shared/editor-project.js";

const SECOND = 1_000_000;

function sampleProject() {
  const project = createEmptyEditorProject({ name: "Montaje" });
  const trackId = project.tracks[0].id;
  project.assets.push({
    id: "asset_a",
    path: "C:/Videos/a.mp4",
    filename: "a.mp4",
    sizeBytes: 1000,
    mtimeMs: 1700000000000,
    metadata: { durationUs: 8 * SECOND },
  });
  project.clips.push({
    id: "clip_1",
    assetId: "asset_a",
    trackId,
    sourceInUs: 0,
    sourceOutUs: 4 * SECOND,
    speed: 1,
  });
  project.tracks[0].clipIds.push("clip_1");
  return project;
}

describe("createEmptyEditorProject", () => {
  it("creates a valid empty document with one video track", () => {
    const project = createEmptyEditorProject();
    expect(project.type).toBe("beru-edit-project");
    expect(project.version).toBe(1);
    expect(project.tracks).toHaveLength(1);
    expect(parseEditorProject(project)).toEqual({ ok: true, project });
  });
});

describe("parseEditorProject validation", () => {
  it("accepts a document with references and intervals in range", () => {
    const project = sampleProject();
    expect(parseEditorProject(project)).toEqual({ ok: true, project });
  });

  it("rejects unsupported document versions with the version in the message", () => {
    const result = parseEditorProject({ ...sampleProject(), version: 2 });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no soportada: 2/);
  });

  it("rejects the Batch project type", () => {
    const result = parseEditorProject({ ...sampleProject(), type: "beru-project" });
    expect(result.ok).toBe(false);
  });

  it("rejects a non-integer timestamp", () => {
    const project = sampleProject();
    project.clips[0].sourceOutUs = 1.5;
    expect(parseEditorProject(project).ok).toBe(false);
  });

  it("accepts an unknown asset duration without bounding the clip", () => {
    const project = sampleProject();
    project.assets[0].metadata.durationUs = null;
    project.clips[0].sourceOutUs = 9 * SECOND;
    expect(parseEditorProject(project)).toEqual({ ok: true, project });
  });

  it.each([
    [
      "rejects a clip whose asset does not exist",
      (project) => {
        project.clips[0].assetId = "missing";
      },
      /asset inexistente/,
    ],
    [
      "rejects a source interval that is empty or reversed",
      (project) => {
        project.clips[0].sourceOutUs = project.clips[0].sourceInUs;
      },
      /intervalo de fuente inválido/,
    ],
    [
      "rejects a source interval beyond the known asset duration",
      (project) => {
        project.clips[0].sourceOutUs = 9 * SECOND;
      },
      /supera la duración/,
    ],
    [
      "rejects duplicate ids across entity kinds",
      (project) => {
        project.clips[0].id = "asset_a";
      },
      /ID duplicado/,
    ],
    [
      "rejects a clip that is missing from its track order",
      (project) => {
        project.tracks[0].clipIds = [];
      },
      /no está en ninguna pista/,
    ],
    [
      "rejects a clip listed in a track other than its own",
      (project) => {
        project.tracks.push({ id: "track_2", kind: "video", clipIds: [] });
        project.tracks[1].clipIds.push("clip_1");
      },
      /otra pista/,
    ],
    [
      "rejects a clip listed twice",
      (project) => {
        project.tracks[0].clipIds.push("clip_1");
      },
      /más de una posición/,
    ],
    [
      "rejects a document with no track",
      (project) => {
        project.tracks = [];
      },
      /al menos una pista/,
    ],
    [
      "rejects an image overlay that references a missing asset",
      (project) => {
        project.overlays.push({
          id: "ov_1",
          kind: "image",
          assetId: "missing",
          startUs: 0,
          endUs: SECOND,
          geometry: { x: 0, y: 0, w: 0.5, h: 0.5 },
        });
      },
      /asset inexistente/i,
    ],
    [
      "rejects overlay geometry outside the canvas",
      (project) => {
        project.overlays.push({
          id: "ov_1",
          kind: "text",
          text: "Hola",
          startUs: 0,
          endUs: SECOND,
          geometry: { x: 0.8, y: 0, w: 0.5, h: 0.2 },
        });
      },
      /fuera del lienzo/,
    ],
  ])("%s", (_name, mutate, message) => {
    const project = sampleProject();
    mutate(project);
    expect(parseEditorProject(project).error).toMatch(message);
  });
});

describe("parseEditorProject", () => {
  it("returns the project when valid and the error otherwise", () => {
    const project = sampleProject();
    expect(parseEditorProject(project)).toEqual({ ok: true, project });
    expect(parseEditorProject({ ...project, version: 9 }).ok).toBe(false);
  });
});
