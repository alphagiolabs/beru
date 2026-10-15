import { beforeEach, describe, expect, it } from "vitest";
import { createEmptyEditorProject } from "../shared/editor-project.js";
import { addAsset, insertClip, setCanvas } from "../shared/editor-timeline.js";
import {
  HISTORY_LIMIT,
  beginGesture,
  cancelGesture,
  commit,
  createHistory,
  endGesture,
  previewGesture,
  redo,
  undo,
} from "../src/features/editor/store/history.js";
import { selectIsDirty, useTimelineStore } from "../src/features/editor/store/useTimelineStore.js";

const SECOND = 1_000_000;

function projectWithClip() {
  const added = addAsset(createEmptyEditorProject(), {
    path: "C:/Videos/a.mp4",
    filename: "a.mp4",
    metadata: { durationUs: 10 * SECOND },
  });
  return insertClip(added.project, { assetId: added.assetId, sourceOutUs: 4 * SECOND }).project;
}

describe("history", () => {
  it("undo returns the exact previous document and redo restores the newer one", () => {
    const base = createEmptyEditorProject();
    const edited = setCanvas(base, { width: 1080, height: 1920 });
    let history = commit(createHistory(base), edited);
    history = undo(history);
    expect(history.present).toBe(base);
    history = redo(history);
    expect(history.present).toBe(edited);
  });

  it("a new commit after undo clears the redo branch", () => {
    const base = createEmptyEditorProject();
    let history = commit(createHistory(base), setCanvas(base, { width: 1080 }));
    history = undo(history);
    history = commit(history, setCanvas(base, { width: 720 }));
    expect(history.future).toEqual([]);
  });

  it("a whole gesture with many previews is one undo entry that restores the start", () => {
    const base = projectWithClip();
    let history = beginGesture(createHistory(base));
    for (let i = 1; i <= 60; i++)
      history = previewGesture(history, setCanvas(base, { width: 1000 + 2 * i }));
    history = endGesture(history);
    expect(history.past).toHaveLength(1);
    expect(undo(history).present).toBe(base);
  });

  it("a gesture that changed nothing leaves no undo entry", () => {
    const base = projectWithClip();
    let history = beginGesture(createHistory(base));
    history = endGesture(previewGesture(history, base));
    expect(history.past).toHaveLength(0);
  });

  it("cancelling a gesture restores the start without an entry", () => {
    const base = projectWithClip();
    let history = beginGesture(createHistory(base));
    history = previewGesture(history, setCanvas(base, { width: 500 }));
    history = cancelGesture(history);
    expect(history.present).toBe(base);
    expect(history.past).toHaveLength(0);
  });

  it("ignores undo while a gesture is open", () => {
    const base = projectWithClip();
    let history = commit(createHistory(base), setCanvas(base, { width: 500 }));
    history = beginGesture(history);
    expect(undo(history)).toBe(history);
  });

  it("keeps at most HISTORY_LIMIT entries", () => {
    let history = createHistory(createEmptyEditorProject());
    for (let i = 1; i <= HISTORY_LIMIT + 20; i++) {
      history = commit(history, setCanvas(history.present, { width: 100 + 2 * i }));
    }
    expect(history.past).toHaveLength(HISTORY_LIMIT);
  });
});

describe("useTimelineStore", () => {
  beforeEach(() => {
    useTimelineStore.getState().open(createEmptyEditorProject());
  });

  it("is dirty after an edit and clean again when undo returns to the saved document", () => {
    const store = useTimelineStore.getState();
    expect(selectIsDirty(useTimelineStore.getState())).toBe(false);
    store.apply((p) => setCanvas(p, { width: 800 }));
    expect(selectIsDirty(useTimelineStore.getState())).toBe(true);
    useTimelineStore.getState().undo();
    expect(selectIsDirty(useTimelineStore.getState())).toBe(false);
  });

  it("opening another document discards the previous history and dirty state", () => {
    const store = useTimelineStore.getState();
    store.apply((p) => setCanvas(p, { width: 800 }));
    useTimelineStore.getState().open(projectWithClip());
    const state = useTimelineStore.getState();
    expect(state.history.past).toEqual([]);
    expect(selectIsDirty(state)).toBe(false);
    expect(state.savedRevision).toBe(state.revision);
  });

  it("counts each committed change once and keeps the error of a rejected one", () => {
    const store = useTimelineStore.getState();
    const before = store.revision;
    expect(store.apply((p) => setCanvas(p, { width: 800 }))).toBe(true);
    expect(useTimelineStore.getState().revision).toBe(before + 1);
    expect(useTimelineStore.getState().apply((p) => setCanvas(p, { width: -1 }))).toBe(false);
    expect(useTimelineStore.getState().lastError).toMatch(/canvas: ancho inválido/);
    expect(useTimelineStore.getState().revision).toBe(before + 1);
  });

  it("marks the written document clean and records its revision", () => {
    const store = useTimelineStore.getState();
    store.apply((p) => setCanvas(p, { width: 800 }));
    const { history, revision } = useTimelineStore.getState();
    useTimelineStore
      .getState()
      .markSaved({ project: history.present, revision, filePath: "C:/a.beru-edit.json" });
    const state = useTimelineStore.getState();
    expect(selectIsDirty(state)).toBe(false);
    expect(state.savedRevision).toBe(revision);
    expect(state.filePath).toBe("C:/a.beru-edit.json");
  });

  it("stays dirty when an edit lands while the save is in flight", () => {
    useTimelineStore.getState().apply((p) => setCanvas(p, { width: 800 }));
    const { history, revision } = useTimelineStore.getState();
    useTimelineStore.getState().apply((p) => setCanvas(p, { width: 900 }));
    useTimelineStore.getState().markSaved({ project: history.present, revision });
    expect(selectIsDirty(useTimelineStore.getState())).toBe(true);
  });

  it("groups a gesture into a single revision bump and undo entry", () => {
    const store = useTimelineStore.getState();
    const before = store.revision;
    store.beginGesture();
    for (let i = 1; i <= 30; i++)
      useTimelineStore.getState().preview((p) => setCanvas(p, { width: 900 + 2 * i }));
    useTimelineStore.getState().endGesture();
    expect(useTimelineStore.getState().revision).toBe(before + 1);
    expect(useTimelineStore.getState().history.past).toHaveLength(1);
  });
});
