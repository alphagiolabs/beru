import { describe, it, expect, beforeEach, vi } from "vitest";

const mockApi = { startProcessing: vi.fn(async () => ({ success: true })) };
globalThis.window = { api: mockApi };

const { default: useEditorStore } = await import("../src/stores/useEditorStore.js");

describe("materializeBatchTextOps", () => {
  beforeEach(() => {
    useEditorStore.setState({
      queue: [{
        path: "C:\\videos\\clip.mp4",
        filename: "clip.mp4",
        width: 1920,
        height: 1080,
        operations: [],
        status: "idle",
        progress: 0,
        error: null,
      }],
      templateRegions: [
        { id: "r1", label: "TEXT_1", region: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 } },
      ],
      excelRows: [{ id: "clip", TEXT_1: "Desde Excel" }],
      excelMapping: { idColumn: "id", columns: { r1: "TEXT_1" } },
    });
  });

  it("creates text operations from Excel-only table values", () => {
    useEditorStore.getState().materializeBatchTextOps();
    const ops = useEditorStore.getState().queue[0].operations;
    expect(ops).toHaveLength(1);
    expect(ops[0].mode).toBe("text");
    expect(ops[0].text).toBe("Desde Excel");
  });
});