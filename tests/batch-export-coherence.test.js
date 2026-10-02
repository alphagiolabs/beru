import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockApi, installMockApi, makeQueueItem, resetEditorState } from "./helpers/store.js";
import { parseSessionSnapshot } from "../src/utils/session-persist.js";

const api = installMockApi(createMockApi());
const { default: useEditorStore } = await import("../src/stores/useEditorStore.js");
const get = useEditorStore.getState;
const region = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };
const template = { id: "r1", label: "TEXT_1", region };

function observe(action) {
  const states = [];
  const off = useEditorStore.subscribe((state) => states.push(state));
  try {
    action();
  } finally {
    off();
  }
  return states;
}

beforeEach(() => {
  resetEditorState(useEditorStore, api, {
    queue: [makeQueueItem({ filename: "a.mp4", path: "C:\\videos\\a.mp4" })],
    templateRegions: [template],
    excelRows: [
      { old: "a", next: "b", TEXT_1: "First" },
      { old: "b", next: "a", TEXT_1: "Second" },
    ],
    excelMapping: { idColumn: "old", columns: { r1: "TEXT_1" } },
    excelRowIndexByFilename: {},
    excelMatchStatus: {},
  });
  get().updateExcelMapping(get().excelMapping);
});

describe("Batch Export / Excel coherent transitions", () => {
  it("publishes a mapping change together with its index, matches and overlay", () => {
    const states = observe(() =>
      get().updateExcelMapping({ idColumn: "next", columns: { r1: "TEXT_1" } }),
    );
    expect(states).toHaveLength(1);
    expect(states[0].excelMapping.idColumn).toBe("next");
    expect(states[0].excelRowIndexByFilename).toEqual({ b: 0, a: 1 });
    expect(states[0].excelMatchStatus).toEqual({ 0: "matched" });
    expect(states[0].queue[0].operations[0].text).toBe("Second");
  });

  it("imports a new workbook in one coherent publication", async () => {
    api.readExcel = vi.fn(async () => ({
      success: true,
      headers: ["id", "TEXT_1"],
      rows: [{ id: "a", TEXT_1: "Imported" }],
    }));
    const states = [];
    const off = useEditorStore.subscribe((state) => states.push(state));
    let result;
    try {
      result = await get().importExcel("C:\\data.xlsx");
    } finally {
      off();
    }
    expect(result).toMatchObject({ success: true, matched: 1, total: 1 });
    expect(states).toHaveLength(1);
    expect(states[0].excelRowIndexByFilename).toEqual({ a: 0 });
    expect(states[0].queue[0].operations[0].text).toBe("Imported");
  });

  it("updates matches when an edit changes the ID column without replacing the edited operation", () => {
    get().updateExcelMapping({ idColumn: "old", columns: { r1: "old" } });
    const op = get().queue[0].operations[0];
    const states = observe(() =>
      get().updateOperation(0, 0, { text: "renamed" }, { recordHistory: false }),
    );
    expect(states).toHaveLength(1);
    expect(states[0].excelRows[0].old).toBe("renamed");
    expect(states[0].excelRowIndexByFilename).toEqual({ renamed: 0, b: 1 });
    expect(states[0].excelMatchStatus).toEqual({ 0: "unmatched" });
    expect(states[0].queue[0].operations[0]).toMatchObject({ id: op.id, text: "renamed" });
  });

  it("loads project template, workbook and derived overlays together", () => {
    const states = observe(() =>
      get()._applyProject({
        type: "beru-project",
        templateRegions: [{ ...template, id: 2 }],
        excel: {
          rows: [{ id: "a", text: "Project" }],
          headers: ["id", "text"],
          mapping: { idColumn: "id", columns: { 2: "text" } },
        },
      }),
    );
    expect(states).toHaveLength(1);
    expect(states[0].templateRegions[0].id).toBe(2);
    expect(states[0].excelRowIndexByFilename).toEqual({ a: 0 });
    expect(states[0].queue[0].operations.find((op) => op.batchRegionId === 2).text).toBe("Project");
  });

  it("clears obsolete workbook indices when loading a project without Excel", () => {
    const states = observe(() =>
      get()._applyProject({ type: "beru-project", templateRegions: [] }),
    );
    expect(states).toHaveLength(1);
    expect(states[0].excelRows).toEqual([]);
    expect(states[0].excelRowIndexByFilename).toEqual({});
    expect(states[0].excelMatchStatus).toEqual({});
  });

  it("remaps a preset and rebuilds its overlays in the same publication", () => {
    const states = observe(() =>
      get().applyPreset({ type: "beru-preset", templateRegions: [{ ...template, id: 2 }] }),
    );
    expect(states).toHaveLength(1);
    expect(states[0].excelMapping.columns).toEqual({ 2: "TEXT_1" });
    expect(states[0].queue[0].operations.map((op) => op.batchRegionId)).toEqual([2]);
    expect(states[0].queue[0].operations[0].text).toBe("First");
  });

  it("adds and removes videos with current matches while keeping existing edits", async () => {
    useEditorStore.setState({
      queue: get().queue.map((item) => ({ ...item, status: "done", progress: 100 })),
    });
    const original = get().queue[0].operations;
    const states = [];
    const off = useEditorStore.subscribe((state) => states.push(state));
    try {
      await get().addVideos(["C:\\videos\\b.mp4"], api);
    } finally {
      off();
    }
    expect(states[0].excelMatchStatus).toEqual({ 0: "matched", 1: "matched" });
    expect(get().queue[0].operations).toBe(original);
    expect(get().queue[0].status).toBe("done");
    const removed = observe(() => get().removeVideo(0));
    expect(removed[0].excelMatchStatus).toEqual({ 0: "matched" });
  });

  it("rebuilds obsolete session derivatives while retaining per-video text, region and style", () => {
    const moved = { x: 0.5, y: 0.6, w: 0.2, h: 0.1 };
    const operation = {
      id: "edited",
      mode: "text",
      batchRegionId: "r1",
      text: "My edit",
      region: moved,
      fontWeight: 900,
    };
    const restored = parseSessionSnapshot({
      version: 1,
      queue: [makeQueueItem({ filename: "a.mp4", operations: [operation] })],
      templateRegions: [template],
      excelRows: [
        { id: "b", text: "Other" },
        { id: "a", text: "Excel" },
      ],
      excelMapping: { idColumn: "id", columns: { r1: "text" } },
      excelRowIndexByFilename: { a: 0 },
      excelMatchStatus: { 0: "duplicate" },
    });
    expect(restored.excelRowIndexByFilename).toEqual({ b: 0, a: 1 });
    expect(restored.excelMatchStatus).toEqual({ 0: "matched" });
    expect(restored.queue[0].operations).toEqual([operation]);
  });

  it("keeps the first duplicate row available without applying its text over an existing edit", () => {
    useEditorStore.setState({
      excelRows: [
        { id: "a", text: "First duplicate" },
        { id: "a", text: "Second duplicate" },
      ],
    });
    const operation = get().queue[0].operations[0];
    const states = observe(() =>
      get().updateExcelMapping({ idColumn: "id", columns: { r1: "text" } }),
    );
    expect(states).toHaveLength(1);
    expect(states[0].excelMatchStatus).toEqual({ 0: "duplicate" });
    expect(get().getExcelRowIndexForVideo(0)).toBe(0);
    expect(states[0].queue[0].operations[0]).toBe(operation);
    expect(get().getCellTextForRegion(0, "r1")).toBe("First");
  });

  it("an ID edit recalculates duplicate matches for all affected videos", async () => {
    await get().addVideos(["C:\\videos\\b.mp4"], api);
    get().updateExcelMapping({ idColumn: "old", columns: { r1: "old" } });
    const states = observe(() =>
      get().updateOperation(0, 0, { text: "b" }, { recordHistory: false }),
    );
    expect(states).toHaveLength(1);
    expect(states[0].excelMatchStatus).toEqual({ 0: "unmatched", 1: "duplicate" });
    expect(states[0].queue[0].operations[0].text).toBe("b");
  });

  it("creates a cell overlay and updates its Excel value without an intermediate blank overlay", () => {
    useEditorStore.setState({
      selectedIdx: -1,
      queue: get().queue.map((item) => ({ ...item, operations: [] })),
    });
    const states = observe(() => get().setTextForRegion(0, "r1", "New edit"));
    expect(states).toHaveLength(1);
    expect(states[0].queue[0].operations[0].text).toBe("New edit");
    expect(states[0].excelRows[0].TEXT_1).toBe("New edit");
  });

  it("deletes a linked overlay and clears its Excel cell in one publication", () => {
    useEditorStore.setState({ selectedIdx: -1 });
    const states = observe(() => get().removeOperationAt(0, 0));
    expect(states).toHaveLength(1);
    expect(states[0].queue[0].operations).toEqual([]);
    expect(states[0].excelRows[0].TEXT_1).toBe("");
    expect(get().getCellTextForRegion(0, "r1")).toBe("");
  });

  it("closing the table materializes overlays and updates ID matches atomically", () => {
    get().updateExcelMapping({ idColumn: "old", columns: { r1: "old" } });
    useEditorStore.setState({
      showTableEditor: true,
      queue: get().queue.map((item) => ({
        ...item,
        operations: item.operations.map((op) => ({ ...op, text: "renamed" })),
      })),
    });
    const states = observe(() => get().setShowTableEditor(false));
    expect(states).toHaveLength(1);
    expect(states[0].showTableEditor).toBe(false);
    expect(states[0].excelRows[0].old).toBe("renamed");
    expect(states[0].excelMatchStatus).toEqual({ 0: "unmatched" });
  });

  it("a restored empty edit stays empty in preview and the export manifest", async () => {
    const restored = parseSessionSnapshot({
      version: 1,
      queue: [
        makeQueueItem({
          filename: "a.mp4",
          operations: [{ id: "cleared", mode: "text", batchRegionId: "r1", region, text: "" }],
        }),
      ],
      templateRegions: [template],
      excelRows: [{ id: "a", TEXT_1: "Saved Excel" }],
      excelMapping: { idColumn: "id", columns: { r1: "TEXT_1" } },
    });
    useEditorStore.setState(restored);
    expect(get().getBatchPreviewPayload(0, "r1").text).toBe("");
    expect(get().buildPreviewFrameJob(0, 0).operations).toEqual([]);
    const result = await get().processSingle(0);
    expect(result.ok).toBe(true);
    expect(api.startProcessing.mock.calls[0][0].jobs[0].operations).toEqual([]);
    expect(get().excelRows[0].TEXT_1).toBe("Saved Excel");
  });

  it.each([false, true])(
    "a preset preserves manual text at the new template geometry (Excel: %s)",
    async (withExcel) => {
      const manual = { id: "manual", mode: "text", region, text: "Keep this", fontWeight: 900 };
      useEditorStore.setState({
        queue: get().queue.map((item) => ({ ...item, operations: [...item.operations, manual] })),
        ...(withExcel ? {} : { excelRows: [], excelMapping: { idColumn: null, columns: {} } }),
      });
      const states = observe(() =>
        get().applyPreset({ type: "beru-preset", templateRegions: [{ ...template, id: 2 }] }),
      );
      expect(states).toHaveLength(1);
      expect(states[0].queue[0].operations).toContainEqual(manual);
      expect(states[0].queue[0].operations.some((op) => op.batchRegionId === "r1")).toBe(false);
      expect(states[0].queue[0].operations.find((op) => op.batchRegionId === 2)).toMatchObject({
        text: withExcel ? "First" : "",
        fontWeight: 400,
      });
      expect(get().getBatchPreviewPayload(0, 2).text).toBe(withExcel ? "First" : "");
      const texts = withExcel ? ["Keep this", "First"] : ["Keep this"];
      expect(
        get()
          .buildPreviewFrameJob(0, 0)
          .operations.map((op) => op.text),
      ).toEqual(texts);
      await get().processSingle(0);
      expect(api.startProcessing.mock.calls[0][0].jobs[0].operations.map((op) => op.text)).toEqual(
        texts,
      );
      expect(get().queue[0].operations.find((op) => op.id === "manual")).toMatchObject(manual);
    },
  );
});
