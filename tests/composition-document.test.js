import { expect, it, vi } from "vitest";
import { createQueueItem } from "../src/utils/types.js";
import useEditorStore from "../src/stores/useEditorStore.js";
import { buildSessionSnapshot, parseSessionSnapshot } from "../src/utils/session-persist.js";
import { compositionJob, parseCompositionDocument } from "../src/utils/composition.js";

it("restores the same canonical edit settings in a composition and a Session", () => {
  const item = {
    path: "C:/a.mp4",
    width: 64,
    height: 64,
    duration: 1,
    operations: [],
    transform: { rotation: 91, flipH: "yes" },
    audio: { gain: null, muted: "yes" },
    timing: { rate: Infinity, repeatCount: 0 },
  };
  const document = {
    type: "beru-composition",
    version: 1,
    canvas: { width: 64, height: 64, fit: "contain" },
    fps: 30,
    entries: [{ id: "a", item }],
  };
  const composition = parseCompositionDocument(document);
  const session = parseSessionSnapshot({ version: 1, queue: [item] });
  expect(composition.entries[0].item.audio).toEqual({ gain: 1, muted: false });
  for (const field of ["audio", "transform", "timing", "externalAudio"])
    expect(composition.entries[0].item[field]).toEqual(session.queue[0][field]);
});

it("owns ordered snapshots and local entry edits without changing queue or Excel identities", () => {
  const queue = [
    createQueueItem({ path: "C:/a.mp4", filename: "a.mp4", width: 320, height: 180, duration: 4 }),
    createQueueItem({ path: "C:/b.mp4", filename: "b.mp4", width: 180, height: 320, duration: 3 }),
  ];
  const excelRows = [{ ID: "a" }, { ID: "b" }];
  useEditorStore.setState({
    queue,
    excelRows,
    selectedIdx: 0,
    isProcessing: false,
    composition: null,
  });
  const store = useEditorStore.getState();
  store.addCompositionEntry(0);
  store.addCompositionEntry(1);
  const ids = useEditorStore.getState().composition.entries.map((entry) => entry.id);
  store.moveCompositionEntry(ids[1], -1);
  store.editCompositionEntry(ids[1], { trimStart: 1, timing: { rate: 2, repeatCount: 1 } });
  const composition = useEditorStore.getState().composition;
  expect(composition.entries.map((entry) => entry.id)).toEqual(ids.toReversed());
  expect(queue[1].trimStart).toBeNull();
  expect(queue[1].timing.rate).toBe(1);
  expect(useEditorStore.getState().queue).toBe(queue);
  expect(useEditorStore.getState().excelRows).toBe(excelRows);
  const restored = parseCompositionDocument(JSON.parse(JSON.stringify(composition)));
  expect(restored.entries[0].item.trimStart).toBe(1);
  expect(
    parseSessionSnapshot(buildSessionSnapshot(useEditorStore.getState())).composition.entries,
  ).toEqual(restored.entries);
  const job = compositionJob(restored, {
    outputPath: "C:/out/composition.mp4",
    encodeProfile: "balanced",
  });
  expect(job.kind).toBe("composition");
  expect(job.id).toBe(-1);
  expect(job.clips.map((clip) => clip.input_path)).toEqual(["C:/b.mp4", "C:/a.mp4"]);
  expect(job.clips[0].playback_rate).toBe(2);
});

it("rejects documents with invalid canvas, duplicate entry identity or unknown version", () => {
  const valid = useEditorStore.getState().composition;
  for (const document of [
    { ...valid, entries: [valid.entries[0], valid.entries[0]] },
    { type: "beru-composition", version: 2, entries: [] },
    {
      type: "beru-composition",
      version: 1,
      canvas: { width: 1, height: 720 },
      fps: 30,
      entries: [],
    },
  ])
    expect(parseCompositionDocument(document)).toBeNull();
});

it("keeps source consent until the last queue or composition owner is removed", () => {
  const release = vi.fn().mockResolvedValue(undefined);
  const before = window.api;
  window.api = { ...before, releaseVideoPaths: release };
  try {
    useEditorStore.setState({
      queue: [
        createQueueItem({
          path: "Z:/a.mp4",
          filename: "a.mp4",
          width: 320,
          height: 180,
          duration: 4,
        }),
      ],
      composition: null,
      selectedIdx: 0,
      isProcessing: false,
    });
    useEditorStore.getState().addCompositionEntry(0);
    const id = useEditorStore.getState().composition.entries[0].id;
    useEditorStore.getState().removeVideo(0);
    expect(release).not.toHaveBeenCalled();
    useEditorStore.getState().removeCompositionEntry(id);
    expect(release).toHaveBeenCalledExactlyOnceWith(["Z:/a.mp4"], []);
  } finally {
    window.api = before;
  }
});

it("rejects malformed operations instead of accepting a document that crashes consumers", () => {
  const document = {
    type: "beru-composition",
    version: 1,
    canvas: { width: 320, height: 180, fit: "contain" },
    fps: 30,
    entries: [{ id: "a", item: { path: "C:/a.mp4", width: 320, height: 180, duration: 1 } }],
  };
  for (const operations of [[null], [42], ["crop"], [[]], { mode: "crop" }]) {
    const entry = { ...document.entries[0], item: { ...document.entries[0].item, operations } };
    expect(parseCompositionDocument({ ...document, entries: [entry] })).toBeNull();
  }
  expect(parseCompositionDocument(document).entries[0].item.operations).toEqual([]);
});
