import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyEditorProject } from "../shared/editor-project.js";
import { addAsset, insertClip, setCanvas } from "../shared/editor-timeline.js";
import {
  exportComposition,
  beginTimelineGesture,
  cancelTimelineGesture,
  endTimelineGesture,
  importSources,
  importImageLayer,
  createPreviewProxy,
  openDocument,
  relinkLibraryAsset,
  saveDocument,
  setTransformOfClip,
} from "../src/features/editor/editor-actions.js";
import { writeAutosave } from "../src/features/editor/store/autosave.js";
import { createHistory } from "../src/features/editor/store/history.js";
import { selectIsDirty, useTimelineStore } from "../src/features/editor/store/useTimelineStore.js";

const SECOND = 1_000_000;

const source = (filename, extra = {}) => ({
  path: `C:/Videos/${filename}`,
  filename,
  sizeBytes: 10,
  mtimeMs: 5,
  metadata: { durationUs: 8 * SECOND, width: 1280, height: 720, hasAudio: true },
  ...extra,
});

function resetStore(project = createEmptyEditorProject()) {
  useTimelineStore.setState({
    history: createHistory(project),
    revision: project.revision,
    savedRevision: null,
    cleanProject: project,
    lastError: null,
    filePath: null,
    assetStatus: {},
    previewPaths: {},
    proxyRequests: {},
  });
}

const store = () => useTimelineStore.getState();

describe("document ownership across pending requests", () => {
  it.each(["save", "videos", "image", "relink", "proxy"])(
    "ignores a late %s result after another document is opened",
    async (operation) => {
      const added = addAsset(createEmptyEditorProject(), source("old.mp4"));
      store().open(added.project, { filePath: "C:/old.beru-edit.json" });
      let resolve;
      const reply = new Promise((done) => {
        resolve = done;
      });
      const api = {
        saveEditorProject: () => reply,
        importEditorVideos: () => reply,
        importEditorImage: () => reply,
        pickEditorReplacement: () => reply,
        createEditorPreviewProxy: () => reply,
      };
      const pending = {
        save: () => saveDocument(api),
        videos: () => importSources(api),
        image: () => importImageLayer(api, 0),
        relink: () => relinkLibraryAsset(api, added.assetId),
        proxy: () => createPreviewProxy(api, added.project.assets[0]),
      }[operation]();
      const current = createEmptyEditorProject({ name: "Current document" });
      store().open(current, { filePath: "C:/current.beru-edit.json" });
      resolve({
        success: true,
        filePath: "C:/old.beru-edit.json",
        path: "C:/proxy.mp4",
        sources: [source("late.mp4")],
        source: source("late.png", { metadata: { durationUs: null, width: 40, height: 40 } }),
        errors: [],
      });
      expect(await pending).toMatchObject({ success: false, canceled: true });
      expect(store().history.present).toBe(current);
      expect(store().cleanProject).toBe(current);
      expect(store().filePath).toBe("C:/current.beru-edit.json");
      expect(store().assetStatus).toEqual({});
      expect(store().previewPaths).toEqual({});
    },
  );

  it("keeps the latest open request when replies arrive out of order", async () => {
    resetStore();
    let resolveFirst;
    const first = openDocument({
      openEditorProject: () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    });
    const current = createEmptyEditorProject({ name: "Second" });
    await openDocument({
      openEditorProject: async () => ({
        success: true,
        project: current,
        filePath: "C:/second.json",
        assets: [],
      }),
    });
    resolveFirst({
      success: true,
      project: createEmptyEditorProject(),
      filePath: "C:/first.json",
      assets: [],
    });
    expect(await first).toMatchObject({ success: false, canceled: true });
    expect(store().history.present).toBe(current);
    expect(store().filePath).toBe("C:/second.json");
  });
});

describe("importSources", () => {
  beforeEach(() => resetStore());

  it("adds each source as an asset and puts the first one on an empty montage", async () => {
    const api = {
      importEditorVideos: vi.fn(async () => ({
        success: true,
        sources: [source("a.mp4"), source("b.mp4")],
        errors: [{ path: "C:/x.txt", error: "No se pudo leer el video" }],
      })),
    };
    const result = await importSources(api);
    expect(result).toEqual({
      success: true,
      imported: 2,
      errors: [{ path: "C:/x.txt", error: "No se pudo leer el video" }],
    });
    const project = store().history.present;
    expect(project.assets.map((a) => a.filename)).toEqual(["a.mp4", "b.mp4"]);
    expect(project.clips).toHaveLength(1);
    expect(project.clips[0].assetId).toBe(project.assets[0].id);
    expect(project.canvas).toMatchObject({ width: 1280, height: 720 });
    expect(Object.values(store().assetStatus)).toEqual(["ready", "ready"]);
  });

  it("keeps the current clip when the montage already has one", async () => {
    const added = addAsset(createEmptyEditorProject(), source("keep.mp4"));
    resetStore(insertClip(added.project, { assetId: added.assetId }).project);
    const api = {
      importEditorVideos: async () => ({ success: true, sources: [source("new.mp4")], errors: [] }),
    };
    await importSources(api);
    const project = store().history.present;
    expect(project.clips[0].assetId).toBe(added.assetId);
    expect(project.assets).toHaveLength(2);
  });

  it("returns cancellation and failures without touching the document", async () => {
    const before = store().history.present;
    expect(
      await importSources({ importEditorVideos: async () => ({ success: false, canceled: true }) }),
    ).toEqual({
      success: false,
      canceled: true,
    });
    expect(store().history.present).toBe(before);
  });
});

describe("saving", () => {
  beforeEach(() => resetStore());

  it("asks for a new path when the document has never been saved", async () => {
    const api = {
      saveEditorProject: vi.fn(async () => ({
        success: true,
        filePath: "C:/m.beru-edit.json",
        revision: 0,
      })),
    };
    await saveDocument(api);
    expect(api.saveEditorProject.mock.calls[0][0]).toMatchObject({
      baseRevision: undefined,
      saveAs: true,
    });
    expect(store().filePath).toBe("C:/m.beru-edit.json");
    expect(selectIsDirty(store())).toBe(false);
  });

  it("sends the base revision on save so a concurrent change is detected", async () => {
    store().apply((p) => setCanvas(p, { width: 800 }));
    store().markSaved({
      project: store().history.present,
      revision: store().revision,
      filePath: "C:/m.beru-edit.json",
    });
    const api = {
      saveEditorProject: vi.fn(async () => ({ success: false, conflict: true, error: "cambió" })),
    };
    store().apply((p) => setCanvas(p, { width: 900 }));
    const result = await saveDocument(api);
    expect(result.conflict).toBe(true);
    expect(api.saveEditorProject.mock.calls[0][0]).toMatchObject({
      baseRevision: store().savedRevision,
      saveAs: false,
    });
    expect(selectIsDirty(store())).toBe(true);
  });

  it("stays dirty when an edit lands while the write is in flight", async () => {
    let finishSave;
    const api = {
      saveEditorProject: vi.fn(
        () =>
          new Promise((resolve) => {
            finishSave = () =>
              resolve({ success: true, filePath: "C:/m.beru-edit.json", revision: 1 });
          }),
      ),
    };
    store().apply((p) => setCanvas(p, { width: 800 }));
    const pending = saveDocument(api, { saveAs: true });
    store().apply((p) => setCanvas(p, { width: 1000 }));
    finishSave();
    await pending;
    expect(selectIsDirty(store())).toBe(true);
  });

  it("writes the present revision into the document and autosaves the same snapshot", async () => {
    store().apply((p) => setCanvas(p, { width: 700 }));
    const api = { writeEditorAutosave: vi.fn(async () => ({ success: true })) };
    await writeAutosave(api);
    expect(api.writeEditorAutosave.mock.calls[0][0].project).toMatchObject({
      canvas: { width: 700 },
      revision: store().revision,
    });
  });
});

describe("opening", () => {
  it("preserves a dirty document when discarding its changes is declined", async () => {
    resetStore();
    store().apply((p) => setCanvas(p, { width: 800 }));
    const current = store().history.present;
    const api = { openEditorProject: vi.fn() };
    const confirmDiscard = vi.fn(async () => false);
    expect(await openDocument(api, { confirmDiscard })).toMatchObject({
      success: false,
      canceled: true,
    });
    expect(confirmDiscard).toHaveBeenCalledOnce();
    expect(api.openEditorProject).not.toHaveBeenCalled();
    expect(store().history.present).toBe(current);
  });

  it("replaces the document, keeps the file path and marks media statuses from the open result", async () => {
    resetStore();
    const added = addAsset(createEmptyEditorProject(), source("open.mp4"));
    const project = insertClip(added.project, { assetId: added.assetId }).project;
    const api = {
      openEditorProject: vi.fn(async () => ({
        success: true,
        filePath: "C:/m.beru-edit.json",
        project,
        assets: [{ id: added.assetId, status: "missing" }],
      })),
    };
    await openDocument(api);
    expect(store().history.present).toBe(project);
    expect(store().filePath).toBe("C:/m.beru-edit.json");
    expect(store().assetStatus).toEqual({ [added.assetId]: "missing" });
    expect(selectIsDirty(store())).toBe(false);
  });
});

describe("preview proxies", () => {
  it("records the proxy for playback without touching the montage or its history", async () => {
    const added = addAsset(createEmptyEditorProject(), source("prores.mov"));
    resetStore(insertClip(added.project, { assetId: added.assetId }).project);
    const before = store().history;
    const api = {
      createEditorPreviewProxy: vi.fn(async () => ({
        success: true,
        path: "C:/ud/editor-proxies/p.mp4",
      })),
    };
    const asset = store().history.present.assets[0];
    expect(await createPreviewProxy(api, asset)).toEqual({
      success: true,
      path: "C:/ud/editor-proxies/p.mp4",
    });
    expect(api.createEditorPreviewProxy.mock.calls[0][0].source).toMatchObject({
      path: "C:/Videos/prores.mov",
      durationUs: 8 * SECOND,
    });
    expect(store().previewPaths).toEqual({ [asset.id]: "C:/ud/editor-proxies/p.mp4" });
    expect(store().history).toBe(before);
  });

  it("asks for an asset's automatic proxy once per opened document", () => {
    const added = addAsset(createEmptyEditorProject(), source("slow.mp4"));
    const project = insertClip(added.project, { assetId: added.assetId }).project;
    resetStore(project);
    const assetId = added.assetId;
    expect(store().requestProxy(assetId)).toBe(true);
    expect(store().requestProxy(assetId)).toBe(false);
    store().open(project);
    expect(store().previewPaths).toEqual({});
    expect(store().requestProxy(assetId)).toBe(true);
  });
});

describe("relinking and export", () => {
  beforeEach(() => resetStore());

  it("points a library item at the picked file and marks it ready again", async () => {
    const added = addAsset(createEmptyEditorProject(), source("old.mp4"));
    resetStore(added.project);
    store().setAssetStatus({ [added.assetId]: "missing" });
    const api = {
      pickEditorReplacement: async () => ({
        success: true,
        source: { path: "D:/Rushes/old.mp4", filename: "old.mp4", sizeBytes: 10, mtimeMs: 5 },
      }),
    };
    expect(await relinkLibraryAsset(api, added.assetId)).toEqual({ success: true });
    expect(store().history.present.assets[0].path).toBe("D:/Rushes/old.mp4");
    expect(store().assetStatus[added.assetId]).toBe("ready");
  });

  it("builds the composition manifest from the montage and hands it to main", async () => {
    const added = addAsset(createEmptyEditorProject(), source("out.mp4"));
    resetStore(
      insertClip(added.project, {
        assetId: added.assetId,
        sourceInUs: SECOND,
        sourceOutUs: 6 * SECOND,
      }).project,
    );
    const api = {
      exportEditorComposition: vi.fn(async () => ({ success: true, filePath: "C:/out.mp4" })),
    };
    await exportComposition(api, { audio: "silence", encodeProfile: "balanced" });
    const { manifest } = api.exportEditorComposition.mock.calls[0][0];
    expect(manifest.type).toBe("beru-job-manifest");
    expect(manifest.jobs[0].clips[0].audio_muted).toBe(true);
    expect(manifest.jobs[0].clips[0]).toMatchObject({
      trim_start: 1,
      trim_end: 6,
      input_path: "C:/Videos/out.mp4",
    });
  });
});

describe("clip transform edits", () => {
  let clipId;
  beforeEach(() => {
    const added = addAsset(createEmptyEditorProject(), source("transform.mp4"));
    const inserted = insertClip(added.project, { assetId: added.assetId });
    clipId = inserted.clipId;
    resetStore(inserted.project);
  });

  it("commits a live edit without requiring the caller to check for a gesture", () => {
    expect(setTransformOfClip(clipId, { zoom: 2 }, { live: true })).toBe(true);
    expect(store().history.present.clips[0].transform.zoom).toBe(2);
    store().undo();
    expect(store().history.present.clips[0].transform.zoom).toBe(1);
  });

  it("groups live transform edits into one undo operation", () => {
    const before = store().revision;
    beginTimelineGesture();
    expect(setTransformOfClip(clipId, { zoom: 2 }, { live: true })).toBe(true);
    expect(setTransformOfClip(clipId, { offsetX: 0.25 }, { live: true })).toBe(true);
    expect(store().revision).toBe(before);
    endTimelineGesture();
    expect(store().revision).toBe(before + 1);
    expect(store().history.present.clips[0].transform).toMatchObject({ zoom: 2, offsetX: 0.25 });
    store().undo();
    expect(store().history.present.clips[0].transform).toMatchObject({ zoom: 1, offsetX: 0 });
    store().redo();
    expect(store().history.present.clips[0].transform).toMatchObject({ zoom: 2, offsetX: 0.25 });
  });

  it("restores the original transform when a gesture is cancelled", () => {
    beginTimelineGesture();
    setTransformOfClip(clipId, { zoom: 2 }, { live: true });
    cancelTimelineGesture();
    expect(store().history.present.clips[0].transform.zoom).toBe(1);
    expect(store().revision).toBe(0);
  });
});
