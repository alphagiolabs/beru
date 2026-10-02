import { beforeEach, describe, expect, it, vi } from "vitest";

const mockApi = { readExcel: vi.fn() };
globalThis.window = { api: mockApi };

const { default: useEditorStore } = await import("../src/stores/useEditorStore.js");

describe("importExcel", () => {
  beforeEach(() => {
    mockApi.readExcel.mockReset();
    useEditorStore.setState({
      queue: [
        {
          path: "C:\\videos\\promo.mp4",
          filename: "promo.mp4",
          width: 1920,
          height: 1080,
          operations: [],
          status: "idle",
          progress: 0,
          error: null,
        },
      ],
      templateRegions: [{ id: "r1", label: "TEXT_1", region: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 } }],
      excelPath: null,
      excelRows: [],
      excelHeaders: [],
      excelMapping: { idColumn: null, columns: {} },
      excelMatchStatus: {},
    });
  });

  it("applies rows, headers and mapping from the parsed IPC payload", async () => {
    mockApi.readExcel.mockResolvedValue({
      success: true,
      rows: [{ id: "promo.mp4", TEXT_1: "Titulo" }],
      headers: ["id", "TEXT_1"],
    });

    const result = await useEditorStore.getState().importExcel("C:\\data\\tabla.xlsx");

    expect(result).toMatchObject({
      success: true,
      rowCount: 1,
      headers: ["id", "TEXT_1"],
      matched: 1,
      unmatched: 0,
      duplicate: 0,
      total: 1,
    });
    expect(result.messageKey).toBe("batch.excelLinkedOk");
    expect(result.messageVars).toMatchObject({ matched: 1, total: 1 });
    const state = useEditorStore.getState();
    expect(state.excelPath).toBe("C:\\data\\tabla.xlsx");
    expect(state.excelHeaders).toEqual(["id", "TEXT_1"]);
    expect(state.excelRows).toEqual([{ id: "promo.mp4", TEXT_1: "Titulo" }]);
    expect(state.excelMapping).toEqual({ idColumn: "id", columns: { r1: "TEXT_1" } });
    expect(state.excelMatchStatus).toEqual({ 0: "matched" });
    expect(state.queue[0].operations[0].text).toBe("Titulo");
  });

  it("falls back to the first header when no ID alias matches", async () => {
    mockApi.readExcel.mockResolvedValue({
      success: true,
      rows: [{ Monto: 5 }],
      headers: ["Monto"],
    });

    await useEditorStore.getState().importExcel("C:\\data\\tabla.xlsx");

    expect(useEditorStore.getState().excelMapping.idColumn).toBe("Monto");
  });

  it("surfaces parse errors reported by the main process", async () => {
    mockApi.readExcel.mockResolvedValue({ success: false, error: "Empty sheet" });

    await expect(useEditorStore.getState().importExcel("C:\\data\\tabla.xlsx")).resolves.toEqual({
      success: false,
      code: "excel_read_failed",
      error: "Empty sheet",
    });
  });

  it("falls back to a generic error when the IPC result is missing", async () => {
    mockApi.readExcel.mockResolvedValue(null);

    await expect(useEditorStore.getState().importExcel("C:\\data\\tabla.xlsx")).resolves.toEqual({
      success: false,
      code: "excel_read_failed",
      error: "Failed to read Excel file",
    });
  });

  it("reports a missing Excel API", async () => {
    const previous = window.api;
    window.api = {};
    try {
      await expect(useEditorStore.getState().importExcel("C:\\data\\tabla.xlsx")).resolves.toEqual({
        success: false,
        code: "excel_api_unavailable",
        error: "Excel API not available",
      });
    } finally {
      window.api = previous;
    }
  });
});
