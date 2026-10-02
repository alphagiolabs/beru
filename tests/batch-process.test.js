import { describe, it, expect } from "vitest";
import {
  buildIdTextOutputName,
  hasVideoDimensions,
  listVideosMissingBatchText,
  sanitizeFilenamePart,
  summarizeQueue,
  videoHasBatchText,
} from "../src/utils/batch-process.js";
describe("batch-process helpers", () => {
  describe("summarizeQueue", () => {
    it("counts terminal queue items only", () => {
      expect(
        summarizeQueue([
          { status: "done" },
          { status: "done" },
          { status: "error" },
          { status: "processing" },
          { status: "idle" },
        ]),
      ).toEqual({ total: 3, succeeded: 2, failed: 1, cancelled: 0 });
    });

    it("returns null when nothing is terminal", () => {
      expect(summarizeQueue([{ status: "processing" }, { status: "idle" }])).toBeNull();
      expect(summarizeQueue([])).toBeNull();
      expect(summarizeQueue(null)).toBeNull();
    });
  });

  describe("videoHasBatchText / listVideosMissingBatchText", () => {
    it("detects videos missing batch text", () => {
      const queue = [{ filename: "a.mp4" }, { filename: "b.mp4" }];
      const regions = [{ id: 1, label: "TEXT_1", region: { x: 0, y: 0, w: 0.2, h: 0.1 } }];
      const getCell = (idx) => (idx === 0 ? "OK" : "");
      expect(videoHasBatchText(0, regions, getCell)).toBe(true);
      expect(videoHasBatchText(1, regions, getCell)).toBe(false);
      expect(listVideosMissingBatchText(queue, regions, getCell)).toEqual(["b.mp4"]);
    });

    it("returns true when there are no template regions (no batch mode)", () => {
      expect(videoHasBatchText(0, [], () => "")).toBe(true);
      expect(videoHasBatchText(0, null, () => "")).toBe(true);
    });

    it("returns empty list when there are no template regions", () => {
      expect(listVideosMissingBatchText([{ filename: "a.mp4" }], [], () => "")).toEqual([]);
    });

    it("uses customOutputName over filename when listing missing videos", () => {
      const queue = [{ filename: "a.mp4", customOutputName: "CustomName" }];
      const regions = [{ id: 1, label: "TEXT_1", region: { x: 0, y: 0, w: 0.2, h: 0.1 } }];
      const result = listVideosMissingBatchText(queue, regions, () => "");
      expect(result).toEqual(["CustomName"]);
    });
  });

  describe("sanitizeFilenamePart / buildIdTextOutputName", () => {
    it("builds ID_TEXT output names with safe filename parts", () => {
      expect(buildIdTextOutputName("promo", "Oferta: 50% / hoy", "mp4")).toBe(
        "promo_Oferta 50% hoy.mp4",
      );
      expect(sanitizeFilenamePart("  a/b:c*  ")).toBe("a b c");
      expect(buildIdTextOutputName("", "Texto", "mp4")).toBe("");
    });

    it("returns empty string when text is blank", () => {
      expect(buildIdTextOutputName("id", "", "mp4")).toBe("");
    });

    it("strips control characters from filename parts", () => {
      expect(sanitizeFilenamePart("test\x00\x01file")).toBe("test file");
    });

    it("sanitizes null/undefined gracefully", () => {
      expect(sanitizeFilenamePart(null)).toBe("");
      expect(sanitizeFilenamePart(undefined)).toBe("");
    });
  });

  describe("hasVideoDimensions", () => {
    it("returns true for valid dimensions", () => {
      expect(hasVideoDimensions({ width: 1920, height: 1080 })).toBe(true);
    });

    it("returns false for zero or missing dimensions", () => {
      expect(hasVideoDimensions({ width: 0, height: 0 })).toBe(false);
      expect(hasVideoDimensions(null)).toBe(false);
      expect(hasVideoDimensions(undefined)).toBe(false);
    });
  });
});
