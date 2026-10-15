import { describe, expect, it } from "vitest";
import {
  EDIT_PROJECT_TYPE,
  EDIT_PROJECT_VERSION,
  createEmptyEditorProject,
  parseEditorProject,
  validateEditorProject,
} from "../shared/editor-project.js";

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
    expect(project.type).toBe(EDIT_PROJECT_TYPE);
    expect(project.version).toBe(EDIT_PROJECT_VERSION);
    expect(project.tracks).toHaveLength(1);
    expect(validateEditorProject(project)).toEqual({ valid: true });
  });
});

describe("validateEditorProject", () => {
  it("accepts a document with references and intervals in range", () => {
    expect(validateEditorProject(sampleProject())).toEqual({ valid: true });
  });

  it("rejects unsupported document versions with the version in the message", () => {
    const result = validateEditorProject({ ...sampleProject(), version: 2 });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/no soportada: 2/);
  });

  it("rejects the Batch project type", () => {
    const result = validateEditorProject({ ...sampleProject(), type: "beru-project" });
    expect(result.valid).toBe(false);
  });

  it("rejects a clip whose asset does not exist", () => {
    const project = sampleProject();
    project.clips[0].assetId = "missing";
    expect(validateEditorProject(project).error).toMatch(/asset inexistente/);
  });

  it("rejects a source interval that is empty or reversed", () => {
    const project = sampleProject();
    project.clips[0].sourceOutUs = project.clips[0].sourceInUs;
    expect(validateEditorProject(project).error).toMatch(/intervalo de fuente inválido/);
  });

  it("rejects a source interval beyond the known asset duration", () => {
    const project = sampleProject();
    project.clips[0].sourceOutUs = 9 * SECOND;
    expect(validateEditorProject(project).error).toMatch(/supera la duración/);
  });

  it("accepts an unknown asset duration without bounding the clip", () => {
    const project = sampleProject();
    project.assets[0].metadata.durationUs = null;
    project.clips[0].sourceOutUs = 9 * SECOND;
    expect(validateEditorProject(project)).toEqual({ valid: true });
  });

  it("rejects duplicate ids across entity kinds", () => {
    const project = sampleProject();
    project.clips[0].id = "asset_a";
    expect(validateEditorProject(project).error).toMatch(/ID duplicado/);
  });

  it("rejects a clip that is missing from its track order", () => {
    const project = sampleProject();
    project.tracks[0].clipIds = [];
    expect(validateEditorProject(project).error).toMatch(/no está en ninguna pista/);
  });

  it("rejects a clip listed in a track other than its own", () => {
    const project = sampleProject();
    project.tracks.push({ id: "track_2", kind: "video", clipIds: [] });
    project.tracks[1].clipIds.push("clip_1");
    expect(validateEditorProject(project).error).toMatch(/otra pista/);
  });

  it("rejects a clip listed twice", () => {
    const project = sampleProject();
    project.tracks[0].clipIds.push("clip_1");
    expect(validateEditorProject(project).error).toMatch(/más de una posición/);
  });

  it("rejects a document with no track", () => {
    const project = sampleProject();
    project.tracks = [];
    expect(validateEditorProject(project).error).toMatch(/al menos una pista/);
  });

  it("rejects an image overlay that references a missing asset", () => {
    const project = sampleProject();
    project.overlays.push({
      id: "ov_1",
      kind: "image",
      assetId: "missing",
      startUs: 0,
      endUs: SECOND,
      geometry: { x: 0, y: 0, w: 0.5, h: 0.5 },
    });
    expect(validateEditorProject(project).error).toMatch(
      /overlay.*asset inexistente|asset inexistente/i,
    );
  });

  it("rejects overlay geometry outside the canvas", () => {
    const project = sampleProject();
    project.overlays.push({
      id: "ov_1",
      kind: "text",
      text: "Hola",
      startUs: 0,
      endUs: SECOND,
      geometry: { x: 0.8, y: 0, w: 0.5, h: 0.2 },
    });
    expect(validateEditorProject(project).error).toMatch(/fuera del lienzo/);
  });

  it("rejects a non-integer timestamp", () => {
    const project = sampleProject();
    project.clips[0].sourceOutUs = 1.5;
    expect(validateEditorProject(project).valid).toBe(false);
  });
});

describe("parseEditorProject", () => {
  it("returns the project when valid and the error otherwise", () => {
    const project = sampleProject();
    expect(parseEditorProject(project)).toEqual({ ok: true, project });
    expect(parseEditorProject({ ...project, version: 9 }).ok).toBe(false);
  });
});
