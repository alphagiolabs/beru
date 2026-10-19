import { expect, it, vi } from "vitest";
import { createProcessingRun } from "../src/utils/processing-run.js";

it("owns a composition result and progress without assigning them to queue[0] or replacing batch summary", async () => {
  const queue = [{ path: "C:/a.mp4", status: "done", exportedOutputPath: "C:/old.mp4" }],
    summary = { total: 2, succeeded: 2 };
  let state = {
    queue,
    batchSummary: summary,
    isProcessing: false,
    jobProgress: {},
    language: "es",
    showToast: vi.fn(),
    exportSignatures: {},
  };
  const set = (patch) => {
    state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
  };
  const run = createProcessingRun(set, () => state),
    handlers = {};
  let resolve;
  const api = {
    startProcessing: vi.fn(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    ),
  };
  for (const key of ["onRunStarted", "onJobProgress", "onComplete", "onSummary", "onFinished"])
    api[key] = (handler) => {
      handlers[key] = handler;
      return () => {};
    };
  const disconnect = run.connect(api);
  const job = {
    id: -1,
    kind: "composition",
    input_path: "C:/a.mp4",
    output_path: "C:/composed.mp4",
  };
  const promise = run.start(
    api,
    {
      ok: true,
      jobs: [job],
      manifest: { jobs: [job] },
      startPatch: {
        queue,
        isProcessing: true,
        mediaExport: { kind: "composition", jobId: -1, progress: 0 },
        exportSignatures: state.exportSignatures,
      },
    },
    -1,
  );
  handlers.onRunStarted({ runId: "composition-1" });
  handlers.onComplete({ runId: "composition-1", index: -1, output: "C:/composed.mp4" });
  handlers.onSummary({ runId: "composition-1", total: 1, succeeded: 1 });
  handlers.onFinished({ runId: "composition-1", code: 0 });
  resolve({ success: true, runId: "composition-1" });
  expect(await promise).toMatchObject({ ok: true, outputPath: "C:/composed.mp4" });
  expect(state.mediaExport.outputPath).toBe("C:/composed.mp4");
  expect(state.queue).toBe(queue);
  expect(state.batchSummary).toBe(summary);
  handlers.onComplete({ runId: "old-batch", index: 0, output: "C:/wrong.mp4" });
  expect(state.queue[0].exportedOutputPath).toBe("C:/old.mp4");
  const video = { id: 0, kind: "video", input_path: "C:/a.mp4", output_path: "C:/next.mp4" };
  const batch = run.start(api, {
    ok: true,
    jobs: [video],
    manifest: { jobs: [video] },
    startPatch: {
      queue: [{ ...queue[0], status: "processing", progress: 0 }],
      isProcessing: true,
      progressDone: 0,
      progressTotal: 1,
      jobProgress: {},
      exportSignatures: state.exportSignatures,
    },
  });
  handlers.onRunStarted({ runId: "batch-2" });
  handlers.onComplete({ runId: "composition-1", index: -1, output: "C:/late.mp4" });
  expect(state.mediaExport.outputPath).toBe("C:/composed.mp4");
  handlers.onComplete({ runId: "batch-2", index: 0, output: video.output_path });
  handlers.onFinished({ runId: "batch-2", code: 0 });
  resolve({ success: true, runId: "batch-2" });
  expect(await batch).toMatchObject({ ok: true });
  expect(state.queue[0].status).toBe("done");
  expect(state.progressDone).toBe(1);
  disconnect();
});

it("reconnects to an active artifact without treating its id as a queue index", () => {
  const queue = [{ path: "C:/a.mp4", status: "done" }];
  let state = {
    queue,
    isProcessing: true,
    activeProcessRunId: "stabilization",
    activeProcessingKind: "stabilization",
    mediaExport: { kind: "stabilization", jobId: -2, status: "processing", progress: 56 },
    progressDone: 1,
    progressTotal: 1,
  };
  const set = (patch) => {
    state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
  };
  const handlers = {};
  const api = Object.fromEntries(
    ["onComplete", "onFinished"].map((key) => [
      key,
      (handler) => {
        handlers[key] = handler;
        return () => {};
      },
    ]),
  );
  const disconnect = createProcessingRun(set, () => state).connect(api);
  handlers.onComplete({ runId: "stabilization", index: -2, output: "C:/stabilized.mp4" });
  handlers.onFinished({ runId: "stabilization", code: 0 });
  expect(state.mediaExport).toMatchObject({
    status: "done",
    confirmedOutputPath: "C:/stabilized.mp4",
    progress: 100,
  });
  expect(state.activeProcessingKind).toBeNull();
  expect(state.queue).toBe(queue);
  expect([state.progressDone, state.progressTotal]).toEqual([1, 1]);
  disconnect();
});

it.each([
  ["composition", -1, "done"],
  ["stabilization", -2, "error"],
  ["composition", -1, "cancelled"],
])("preserves batch progress after %s (job %i) finishes as %s", async (kind, id, status) => {
  vi.useFakeTimers();
  const queue = [0, 1, 2].map((i) => ({ path: `C:/${i}.mp4`, status: "done" }));
  let state = {
    queue,
    isProcessing: false,
    jobProgress: {},
    progressDone: 3,
    progressTotal: 3,
    language: "es",
    showToast: vi.fn(),
    exportSignatures: {},
  };
  const set = (patch) => {
    state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
  };
  const run = createProcessingRun(set, () => state);
  const handlers = {};
  let resolve;
  const api = {
    startProcessing: () =>
      new Promise((done) => {
        resolve = done;
      }),
  };
  for (const key of [
    "onRunStarted",
    "onProgress",
    "onJobProgress",
    "onComplete",
    "onJobError",
    "onJobCancelled",
    "onSummary",
    "onFinished",
  ])
    api[key] = (handler) => {
      handlers[key] = handler;
      return () => {};
    };
  const disconnect = run.connect(api);
  const job = { id, kind, input_path: "C:/a.mp4", output_path: "C:/c.mp4" };
  const promise = run.start(
    api,
    {
      ok: true,
      jobs: [job],
      manifest: { jobs: [job] },
      startPatch: {
        queue: state.queue,
        isProcessing: true,
        mediaExport: { kind, jobId: id, status: "processing", progress: 0 },
        exportSignatures: state.exportSignatures,
      },
    },
    id,
  );
  expect(state.activeProcessingKind).toBe(kind);
  expect(state.mediaExport.kind).toBe(kind);
  try {
    handlers.onRunStarted({ runId: "artifact" });
    handlers.onProgress({ runId: "artifact", current: 0, total: 1 });
    handlers.onJobProgress({ runId: "artifact", index: id, percent: 56 });
    await vi.advanceTimersByTimeAsync(60);
    expect(state.mediaExport.progress).toBe(56);
    expect([state.progressDone, state.progressTotal]).toEqual([3, 3]);
    const event =
      status === "done" ? "onComplete" : status === "error" ? "onJobError" : "onJobCancelled";
    handlers[event]({
      runId: "artifact",
      index: id,
      output: job.output_path,
      error: status === "error" ? "failed" : null,
    });
    handlers.onFinished({
      runId: "artifact",
      code: status === "done" ? 0 : 1,
      cancelled: status === "cancelled",
    });
    resolve({ success: status === "done", cancelled: status === "cancelled", runId: "artifact" });
    await promise;
    expect(state.mediaExport.status).toBe(status);
    expect([state.progressDone, state.progressTotal]).toEqual([3, 3]);
    expect(state.queue).toBe(queue);
    expect(state.activeProcessingKind).toBeNull();
  } finally {
    disconnect();
    vi.useRealTimers();
  }
});
