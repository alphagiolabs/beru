import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createPathSecurity } from "../main/pathSecurity.js";
import useEditorStore from "../src/stores/useEditorStore.js";
import { useTimelineStore } from "../src/features/editor/store/useTimelineStore.js";
import { createEmptyEditorProject } from "../shared/editor-project.js";
import { addAsset, relinkAsset } from "../shared/editor-timeline.js";
import { createQueueItem } from "../src/utils/types.js";

let directory, security;
const originalApi = window.api;

beforeEach(() => {
  useEditorStore.setState({ queue: [], composition: null, isProcessing: false });
  useTimelineStore.getState().open(createEmptyEditorProject());
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "beru-owners-"));
  security = createPathSecurity({
    isPackaged: false,
    getAppPath: () => path.join(directory, "trusted", "app"),
    getPath: (name) => path.join(directory, "trusted", name),
  });
  window.api = { releaseVideoPaths: async (...args) => security.releaseVideoPaths(...args) };
});

afterEach(() => {
  useEditorStore.setState({ queue: [], composition: null });
  useTimelineStore.getState().open(createEmptyEditorProject());
  window.api = originalApi;
  fs.rmSync(directory, { recursive: true, force: true });
});

function selectedSource(name) {
  const file = path.join(directory, name);
  fs.writeFileSync(file, "source");
  expect(security.validateReadableFile(file, "video").ok).toBe(false);
  expect(security.registerSelectedPath(file, "video").ok).toBe(true);
  return {
    path: file,
    filename: name,
    metadata: { width: 320, height: 180, durationUs: 1_000_000 },
  };
}

it("retains external media until its queue, composition and montage owners have all released it", () => {
  const source = selectedSource("shared.mp4");
  useEditorStore.setState({
    queue: [createQueueItem({ ...source, width: 320, height: 180, duration: 1 })],
  });
  useEditorStore.getState().addCompositionEntry(0);
  const entryId = useEditorStore.getState().composition.entries[0].id;
  useTimelineStore.getState().open(addAsset(createEmptyEditorProject(), source).project);
  useEditorStore.getState().removeVideo(0);
  useEditorStore.getState().removeCompositionEntry(entryId);
  expect(security.validateReadableFile(source.path, "video").ok).toBe(true);
  useTimelineStore.getState().open(createEmptyEditorProject());
  expect(security.validateReadableFile(source.path, "video").ok).toBe(false);
});

it("retains relinked sources for undo and releases them when the document history is replaced", () => {
  const first = selectedSource("first.mp4"),
    second = selectedSource("second.mp4");
  const added = addAsset(createEmptyEditorProject(), first);
  useTimelineStore.getState().open(added.project);
  useTimelineStore.getState().apply((project) => relinkAsset(project, added.assetId, second));
  expect(security.validateReadableFile(first.path, "video").ok).toBe(true);
  useTimelineStore.getState().undo();
  expect(security.validateReadableFile(second.path, "video").ok).toBe(true);
  useTimelineStore.getState().open(createEmptyEditorProject());
  expect(security.validateReadableFile(first.path, "video").ok).toBe(false);
  expect(security.validateReadableFile(second.path, "video").ok).toBe(false);
});
