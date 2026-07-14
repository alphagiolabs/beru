import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("run-scoped terminal events (plan 025)", () => {
  it("main process tags finished/error with runId and emits process:runStarted", () => {
    const processSrc = readFileSync(join(__dirname, "../main/handlers/process.js"), "utf8");
    expect(processSrc).toContain('sendToRenderer("process:runStarted"');
    expect(processSrc).toContain("runId");
    expect(processSrc).toMatch(/process:finished[\s\S]*runId/);
    expect(processSrc).toMatch(/process:error[\s\S]*runId/);

    const shared = readFileSync(join(__dirname, "../main/shared-state.js"), "utf8");
    expect(shared).toContain("runId: staleRunId");

    const preload = readFileSync(join(__dirname, "../main/preload.cjs"), "utf8");
    expect(preload).toContain("onRunStarted");
    expect(preload).toContain("process:runStarted");

    const hook = readFileSync(join(__dirname, "../src/hooks/useProcessing.js"), "utf8");
    expect(hook).toContain("isStaleRunEvent");
    expect(hook).toContain("activeProcessRunId");
    expect(hook).toContain("onRunStarted");
  });
});

describe("useProcessing stale-run helper (unit)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("store tracks activeProcessRunId and clears on abort", async () => {
    // Lightweight store smoke without mounting React: import slice via editor store.
    const { default: useEditorStore } = await import("../src/stores/useEditorStore.js");
    useEditorStore.setState({
      isProcessing: true,
      activeProcessRunId: "run-a",
      queue: [],
    });
    expect(useEditorStore.getState().activeProcessRunId).toBe("run-a");
    useEditorStore.getState().setActiveProcessRunId("run-b");
    expect(useEditorStore.getState().activeProcessRunId).toBe("run-b");
    useEditorStore.getState().abortActiveProcessing();
    expect(useEditorStore.getState().activeProcessRunId).toBeNull();
    expect(useEditorStore.getState().isProcessing).toBe(false);
  });
});
