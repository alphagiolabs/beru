import { describe, expect, it } from "vitest";
import { appendProcessingLog, formatProcessingLogs } from "../src/utils/processing-logs.js";

describe("processing logs", () => {
  it("keeps only the latest log lines", () => {
    let lines = [];
    for (let i = 0; i < 5; i++) {
      lines = appendProcessingLog(lines, `line ${i}`, 3);
    }

    expect(lines).toEqual(["line 2", "line 3", "line 4"]);
  });

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
});
