import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * Regression: cancel must emit a single terminal event, never abort a newer
 * run, and never spawn an unowned processor after cancel during writeFile.
 */

const processSrc = fs.readFileSync(
  path.join(process.cwd(), "main", "handlers", "process.js"),
  "utf-8",
);
const sharedSrc = fs.readFileSync(path.join(process.cwd(), "main", "shared-state.js"), "utf-8");

describe("cancel ownership contract (source)", () => {
  it("shared-state exposes cancelling run id helpers", () => {
    expect(sharedSrc).toMatch(/getCancellingRunId/);
    expect(sharedSrc).toMatch(/setCancellingRunId/);
    expect(sharedSrc).toMatch(/clearCancellingRunId/);
  });

  it("cancelActiveProcessing no-ops when idle without finished emit", () => {
    const cancelFn = processSrc.slice(
      processSrc.indexOf("export async function cancelActiveProcessing"),
      processSrc.indexOf("export function registerProcessHandlers"),
    );
    expect(cancelFn).toMatch(/idle:\s*true/);
    expect(cancelFn).toMatch(/!runId\s*&&\s*!proc/);
  });

  it("re-checks isCurrentRun after writeFile and before spawn", () => {
    const writeIdx = processSrc.indexOf("fs.promises.writeFile");
    const spawnIdx = processSrc.indexOf("spawn(spawnSpec.command");
    expect(writeIdx).toBeGreaterThan(-1);
    expect(spawnIdx).toBeGreaterThan(writeIdx);
    const between = processSrc.slice(writeIdx, spawnIdx);
    expect(between).toMatch(/isCurrentRun\(\)/);
  });

  it("onClose treats cancelling run as cancelled finished", () => {
    const onCloseMatch = processSrc.match(/const onClose = \(code\) => \{([\s\S]*?)\n\s{6}\};/);
    expect(onCloseMatch, "onClose function must exist").not.toBeNull();
    const body = onCloseMatch[1];
    expect(body).toMatch(/getCancellingRunId|cancellingThisRun/);
    expect(body).toMatch(/cancelled:\s*true/);
  });

  it("cancelActiveProcessing only emits finished when the same run is still current", () => {
    const cancelFn = processSrc.slice(
      processSrc.indexOf("export async function cancelActiveProcessing"),
      processSrc.indexOf("export function registerProcessHandlers"),
    );
    expect(cancelFn).toMatch(/getProcessingRunId\(\)\s*===\s*runId/);
    expect(cancelFn).toMatch(/process:finished/);
  });

  it("settleRun drops orphaned python process ref when run is no longer current", () => {
    expect(processSrc).toMatch(/getPythonProcess\(\)\s*===\s*proc/);
  });
});
