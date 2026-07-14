import { describe, it, expect, vi, beforeEach } from "vitest";

describe("exportExcel (plan 022)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("writes workbook from in-memory rows via save dialog", async () => {
    const writeExcel = vi.fn(async () => ({ success: true, filePath: "C:\\out\\export.xlsx" }));
    const saveExcelDialog = vi.fn(async () => ({
      canceled: false,
      filePath: "C:\\out\\export.xlsx",
    }));
    window.api = {
      saveExcelDialog,
      writeExcel,
    };

    const { default: useEditorStore } = await import("../src/stores/useEditorStore.js");
    useEditorStore.setState({
      excelHeaders: ["id", "text"],
      excelRows: [
        { id: "a", text: "hola" },
        { id: "b", text: "adios" },
      ],
      excelPath: "C:\\data\\source.xlsx",
    });

    const res = await useEditorStore.getState().exportExcel();
    expect(res.ok).toBe(true);
    expect(saveExcelDialog).toHaveBeenCalled();
    expect(writeExcel).toHaveBeenCalledTimes(1);
    const [path, base64] = writeExcel.mock.calls[0];
    expect(path).toBe("C:\\out\\export.xlsx");
    expect(typeof base64).toBe("string");
    expect(base64.length).toBeGreaterThan(20);
  });

  it("returns canceled when user dismisses dialog", async () => {
    window.api = {
      saveExcelDialog: vi.fn(async () => ({ canceled: true })),
      writeExcel: vi.fn(),
    };
    const { default: useEditorStore } = await import("../src/stores/useEditorStore.js");
    useEditorStore.setState({
      excelHeaders: ["id"],
      excelRows: [{ id: "a" }],
    });
    const res = await useEditorStore.getState().exportExcel();
    expect(res).toMatchObject({ ok: false, canceled: true });
    expect(window.api.writeExcel).not.toHaveBeenCalled();
  });

  it("fails when there are no rows", async () => {
    window.api = {
      saveExcelDialog: vi.fn(),
      writeExcel: vi.fn(),
    };
    const { default: useEditorStore } = await import("../src/stores/useEditorStore.js");
    useEditorStore.setState({ excelHeaders: [], excelRows: [] });
    const res = await useEditorStore.getState().exportExcel();
    expect(res.ok).toBe(false);
    expect(window.api.saveExcelDialog).not.toHaveBeenCalled();
  });
});
