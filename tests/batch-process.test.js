import { describe, it, expect } from "vitest";
import {
  buildIdTextOutputName,
  filterOperationsForExport,
  listVideosMissingBatchText,
  sanitizeFilenamePart,
  videoHasBatchText,
} from "../src/utils/batch-process.js";

describe("batch-process helpers", () => {
  it("filters empty text operations before export", () => {
    const ops = [
      { mode: "blur", region: { x: 0, y: 0, w: 0.1, h: 0.1 } },
      { mode: "text", text: "  ", region: { x: 0.1, y: 0.1, w: 0.2, h: 0.1 } },
      { mode: "text", text: "Hola", region: { x: 0.2, y: 0.2, w: 0.2, h: 0.1 } },
    ];
    expect(filterOperationsForExport(ops)).toHaveLength(2);
    expect(filterOperationsForExport(ops)[1].text).toBe("Hola");
  });

  it("filters image operations without a path before export", () => {
    const ops = [
      { mode: "blur", region: { x: 0, y: 0, w: 0.1, h: 0.1 } },
      { mode: "image", imagePath: "", region: { x: 0.1, y: 0.1, w: 0.2, h: 0.1 } },
      {
        mode: "image",
        imagePath: "C:\\img\\logo.png",
        region: { x: 0.2, y: 0.2, w: 0.2, h: 0.1 },
      },
    ];
    expect(filterOperationsForExport(ops)).toHaveLength(2);
    expect(filterOperationsForExport(ops)[1].imagePath).toBe("C:\\img\\logo.png");
  });

  it("detects videos missing batch text", () => {
    const queue = [{ filename: "a.mp4" }, { filename: "b.mp4" }];
    const regions = [{ id: 1, label: "TEXT_1", region: { x: 0, y: 0, w: 0.2, h: 0.1 } }];
    const getCell = (idx) => (idx === 0 ? "OK" : "");
    expect(videoHasBatchText(0, regions, getCell)).toBe(true);
    expect(videoHasBatchText(1, regions, getCell)).toBe(false);
    expect(listVideosMissingBatchText(queue, regions, getCell)).toEqual(["b.mp4"]);
  });

  it("builds ID_TEXT-1 output names with safe filename parts", () => {
    expect(buildIdTextOutputName("promo", "Oferta: 50% / hoy", "mp4")).toBe(
      "promo_Oferta 50% hoy-1.mp4",
    );
    expect(sanitizeFilenamePart("  a/b:c*  ")).toBe("a b c");
    expect(buildIdTextOutputName("", "Texto", "mp4")).toBe("");
  });
});
