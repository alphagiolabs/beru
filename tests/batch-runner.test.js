import { describe, it, expect, vi, beforeEach } from "vitest";
import { validateBatchReady, runBatch, runSingle, cancelBatch } from "../src/utils/batch-runner.js";

function item(overrides = {}) {
  return {
    path: "C:\\videos\\a.mp4",
    filename: "a.mp4",
    width: 1920,
    height: 1080,
    customOutputName: "",
    ...overrides,
  };
}

function makeHooks(overrides = {}) {
  return {
    startExecutionRun: vi.fn(),
    applyPatch: vi.fn(),
    getQueue: vi.fn(() => [item()]),
    finalizeActiveExecution: vi.fn(),
    summarizeQueue: vi.fn(() => ({ total: 1, succeeded: 1, failed: 0 })),
    ...overrides,
  };
}

describe("batch-runner", () => {
  describe("validateBatchReady", () => {
    it("fails when videos lack dimensions", () => {
      const result = validateBatchReady({
        queue: [item({ width: 0, height: 0 })],
        templateRegions: [],
        getCellText: () => "",
      });
      expect(result).toMatchObject({ ok: false, code: "missing_dimensions" });
      expect(result.details.missing).toHaveLength(1);
    });

    it("fails when batch text is missing", () => {
      const result = validateBatchReady({
        queue: [item()],
        templateRegions: [{ id: 1, label: "TEXT_1" }],
        getCellText: () => "",
      });
      expect(result).toMatchObject({ ok: false, code: "missing_batch_text" });
    });

    it("passes when queue is ready", () => {
      const result = validateBatchReady({
        queue: [item()],
        templateRegions: [],
        getCellText: () => "",
      });
      expect(result).toEqual({ ok: true });
    });
  });

  describe("runBatch", () => {
    let api;
    let hooks;

    beforeEach(() => {
      api = { startProcessing: vi.fn(async () => ({ success: true })) };
      hooks = makeHooks();
    });

    it("starts execution, applies start patch, and calls startProcessing", async () => {
      const jobs = [{ id: 0, input_path: "a.mp4", output_path: "out.mp4" }];
      const result = await runBatch({
        api,
        jobs,
        queue: [item()],
        hooks,
      });
      expect(result).toEqual({ ok: true });
      expect(hooks.startExecutionRun).toHaveBeenCalledWith({ kind: "batch", jobCount: 1 });
      expect(hooks.applyPatch).toHaveBeenCalledWith(
        expect.objectContaining({ isProcessing: true, progressTotal: 1 }),
      );
      expect(api.startProcessing).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "beru-job-manifest",
          version: 1,
          jobs,
        }),
      );
    });

    it("returns no_jobs when jobs empty", async () => {
      const result = await runBatch({ api, jobs: [], queue: [], hooks });
      expect(result).toMatchObject({ ok: false, code: "no_jobs" });
      expect(api.startProcessing).not.toHaveBeenCalled();
    });

    it("returns error and clears processing when startProcessing fails pre-spawn", async () => {
      api.startProcessing.mockResolvedValue({ success: false, error: "spawn failed" });
      const setProcessing = vi.fn();
      const result = await runBatch({
        api,
        jobs: [{ id: 0 }],
        queue: [item()],
        hooks: { ...hooks, setProcessing },
      });
      expect(result).toMatchObject({ ok: false, error: "spawn failed" });
      expect(setProcessing).toHaveBeenCalledWith(false);
      expect(hooks.applyPatch).not.toHaveBeenCalledWith({ isProcessing: false });
    });

    it("returns api_unavailable when api missing", async () => {
      const result = await runBatch({
        api: {},
        jobs: [{ id: 0 }],
        queue: [item()],
        hooks,
      });
      expect(result).toMatchObject({ ok: false, code: "api_unavailable" });
    });
  });

  describe("runSingle", () => {
    it("runs one job and finalizes execution", async () => {
      const api = { startProcessing: vi.fn(async () => ({ success: true })) };
      const hooks = makeHooks({
        getQueue: vi.fn(() => [item({ status: "done" })]),
      });
      const job = { id: 0, output_path: "C:\\out\\a.mp4" };
      const result = await runSingle({
        api,
        job,
        videoIdx: 0,
        queue: [item()],
        hooks,
      });
      expect(result.ok).toBe(true);
      expect(result.outputPath).toBe("C:\\out\\a.mp4");
      expect(hooks.startExecutionRun).toHaveBeenCalledWith({ kind: "single", jobCount: 1 });
      expect(hooks.finalizeActiveExecution).toHaveBeenCalled();
      expect(hooks.applyPatch).toHaveBeenCalledWith({ isProcessing: false });
    });

    it("returns error when already processing", async () => {
      const result = await runSingle({
        api: { startProcessing: vi.fn() },
        job: { id: 0 },
        videoIdx: 0,
        queue: [item()],
        isProcessing: true,
        hooks: makeHooks(),
      });
      expect(result).toMatchObject({ ok: false, code: "already_processing" });
    });
  });

  describe("cancelBatch", () => {
    it("cancels via api and applies abort patch", async () => {
      const api = { cancelProcessing: vi.fn(async () => {}) };
      const hooks = makeHooks({
        getQueue: () => [item({ status: "processing", progress: 20 })],
      });
      await cancelBatch({ api, hooks });
      expect(api.cancelProcessing).toHaveBeenCalled();
      expect(hooks.applyPatch).toHaveBeenCalledWith(
        expect.objectContaining({ isProcessing: false, jobProgress: {} }),
      );
    });

    it("prefers abortActiveProcessing when provided", async () => {
      const api = { cancelProcessing: vi.fn(async () => {}) };
      const abortActiveProcessing = vi.fn();
      await cancelBatch({
        api,
        hooks: { abortActiveProcessing },
      });
      expect(api.cancelProcessing).toHaveBeenCalled();
      expect(abortActiveProcessing).toHaveBeenCalled();
    });
  });
});
