import { describe, expect, it } from "vitest";
import { appendProcessingLog, formatProcessingLogs } from "../src/utils/processing-logs.js";

describe("processing logs", () => {
  describe("appendProcessingLog", () => {
    it("keeps only the latest log lines", () => {
      let lines = [];
      for (let i = 0; i < 5; i++) {
        lines = appendProcessingLog(lines, `line ${i}`, 3);
      }

      expect(lines).toEqual(["line 2", "line 3", "line 4"]);
    });

    it("stringifies non-string input", () => {
      const lines = appendProcessingLog([], { error: "test" });
      expect(lines).toEqual(['{"error":"test"}']);
    });

    it("handles invalid lines array gracefully", () => {
      const result = appendProcessingLog(null, "test");
      expect(result).toEqual(["test"]);
    });

    it("respects custom limit parameter", () => {
      let lines = [];
      for (let i = 0; i < 10; i++) {
        lines = appendProcessingLog(lines, `line ${i}`, 5);
      }
      expect(lines).toHaveLength(5);
      expect(lines[0]).toBe("line 5");
    });
  });

  describe("formatProcessingLogs", () => {
    it("formats logs for export with metadata", () => {
      const text = formatProcessingLogs(["a", "b"], {
        exportedAt: "2026-06-05T00:00:00.000Z",
        summary: "2/2 OK, 0 failed",
      });

      expect(text).toContain("Beru processing log");
      expect(text).toContain("Exported: 2026-06-05T00:00:00.000Z");
      expect(text).toContain("Summary: 2/2 OK, 0 failed");
      expect(text.endsWith("a\nb")).toBe(true);
    });

    it("omits summary line when not provided", () => {
      const text = formatProcessingLogs(["line1"], {
        exportedAt: "2026-06-05T00:00:00.000Z",
      });
      expect(text).not.toContain("Summary:");
    });

    it("handles empty lines array", () => {
      const text = formatProcessingLogs([], {
        exportedAt: "2026-06-05T00:00:00.000Z",
      });
      expect(text).toContain("Beru processing log");
      expect(text).toContain("Exported: 2026-06-05T00:00:00.000Z");
    });

    it("handles invalid lines input gracefully", () => {
      const text = formatProcessingLogs(null, {
        exportedAt: "2026-06-05T00:00:00.000Z",
      });
      expect(text).toContain("Beru processing log");
    });
  });
});
