import { describe, it, expect, beforeEach, vi } from "vitest";

const mockApi = { startProcessing: vi.fn(async () => ({ success: true })) };
globalThis.window = { api: mockApi };

const { default: useEditorStore } = await import("../src/stores/useEditorStore.js");
const { normalizeMatchId } = await import("../src/utils/video-utils.js");

describe("normalizeMatchId", () => {
  it("strips extension and normalizes case", () => {
    expect(normalizeMatchId("Clip.MP4")).toBe("clip");
    expect(normalizeMatchId("clip.mp4")).toBe("clip");
    expect(normalizeMatchId("  Intro_001  ")).toBe("intro_001");
  });
});

describe("Excel row matching with extension in ID column", () => {
  beforeEach(() => {
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
      excelRows: [{ id: "promo.mp4", TEXT_1: "Titulo" }],
      excelMapping: { idColumn: "id", columns: { r1: "TEXT_1" } },
    });
  });

  it("_reapplyExcel links rows when Excel ID includes the file extension", () => {
    const report = useEditorStore.getState()._reapplyExcel();
    expect(report.matched).toBe(1);
    expect(useEditorStore.getState().queue[0].operations[0].text).toBe("Titulo");
  });

  it("getCellTextForRegion reads Excel text after extension-normalized match", () => {
    useEditorStore.getState()._reapplyExcel();
    expect(useEditorStore.getState().getCellTextForRegion(0, "r1")).toBe("Titulo");
  });
});
