import { describe, it, expect } from "vitest";
import { prepareRun } from "../src/utils/export-run.js";

function item(overrides = {}) {
  return {
    path: "C:\\videos\\a.mp4",
    filename: "a.mp4",
    width: 1920,
    height: 1080,
    duration: 10,
    videoCodec: "h264",
    operations: [],
    status: "idle",
    progress: 0,
    error: null,
    customOutputName: "",
    ...overrides,
  };
}

const batchInput = (queue, overrides = {}) => ({
  queue,
  outputPaths: queue.map((_, i) => `C:\\out\\${i}.mp4`),
  encodeProfile: "balanced",
  watermark: null,
  ...overrides,
});

describe("prepareRun — batch", () => {
  it("returns jobs, manifest, signatures and start patch for a ready queue", () => {
    const queue = [item(), item({ path: "C:\\videos\\b.mp4", filename: "b.mp4" })];
    const prepared = prepareRun(batchInput(queue));

    expect(prepared.ok).toBe(true);
    expect(prepared.jobs).toHaveLength(2);
    expect(prepared.jobs[0]).toMatchObject({ id: 0, output_path: "C:\\out\\0.mp4" });
    expect(prepared.manifest).toMatchObject({
      type: "beru-job-manifest",
      version: 1,
      jobs: prepared.jobs,
    });
    expect(prepared.signatures[0]).toBe(JSON.stringify(prepared.jobs[0]));
    expect(prepared.startPatch).toMatchObject({
      isProcessing: true,
      progressTotal: 2,
      progressDone: 0,
      jobProgress: {},
      batchSummary: null,
      exportSignatures: prepared.signatures,
    });
    expect(prepared.startPatch.queue.every((q) => q.status === "idle" && q.progress === 0)).toBe(
      true,
    );
  });

  it("threads encodeProfile and watermark into every job", () => {
    const watermark = { enabled: true, text: "wm" };
    const prepared = prepareRun(batchInput([item()], { encodeProfile: "fast", watermark }));
    expect(prepared.jobs[0].encode_profile).toBe("fast");
    expect(prepared.jobs[0].watermark).toBe(watermark);
  });

  it("fails with missing_dimensions when a video lacks size", () => {
    const prepared = prepareRun(batchInput([item({ width: 0, height: 0 })]));
    expect(prepared.ok).toBe(false);
    expect(prepared.code).toBe("missing_dimensions");
    expect(prepared.details.count).toBe(1);
  });

  it("fails with missing_batch_text when a template cell is empty", () => {
    const prepared = prepareRun(
      batchInput([item()], {
        templateRegions: [{ id: "r1", label: "TEXT_1" }],
        getCellText: () => "",
      }),
    );
    expect(prepared).toMatchObject({ ok: false, code: "missing_batch_text" });
  });

  it("passes batch text validation when the cell resolver returns text", () => {
    const prepared = prepareRun(
      batchInput([item()], {
        templateRegions: [{ id: "r1", label: "TEXT_1" }],
        getCellText: () => "Hola",
      }),
    );
    expect(prepared.ok).toBe(true);
  });

  it("fails with no_jobs on an empty queue", () => {
    const prepared = prepareRun(batchInput([]));
    expect(prepared).toMatchObject({ ok: false, code: "no_jobs" });
  });
});

describe("prepareRun — single", () => {
  it("builds one job keyed by the queue index and merges signatures", () => {
    const queue = [item(), item({ path: "C:\\videos\\b.mp4", filename: "b.mp4" })];
    const existing = { 0: "stale-signature" };
    const prepared = prepareRun(batchInput(queue, { videoIdx: 1, exportSignatures: existing }));

    expect(prepared.ok).toBe(true);
    expect(prepared.jobs).toHaveLength(1);
    expect(prepared.jobs[0].id).toBe(1);
    expect(prepared.manifest.jobs).toHaveLength(1);
    expect(prepared.signatures[0]).toBe("stale-signature");
    expect(prepared.signatures[1]).toBe(JSON.stringify(prepared.jobs[0]));
    expect(prepared.startPatch).toMatchObject({ isProcessing: true, progressTotal: 1 });
    expect(prepared.startPatch.queue[1].status).toBe("processing");
    expect(prepared.startPatch.queue[0].status).toBe("idle");
  });

  it("rejects an out-of-range index", () => {
    const prepared = prepareRun(batchInput([item()], { videoIdx: 5 }));
    expect(prepared).toMatchObject({ ok: false, code: "invalid_video", error: "Video inválido" });
  });

  it("rejects a non-integer index", () => {
    const prepared = prepareRun(batchInput([item()], { videoIdx: "0" }));
    expect(prepared).toMatchObject({ ok: false, code: "invalid_video" });
  });

  it("does not run batch text validation in single mode", () => {
    const prepared = prepareRun(
      batchInput([item()], {
        videoIdx: 0,
        templateRegions: [{ id: "r1", label: "TEXT_1" }],
        getCellText: () => "",
      }),
    );
    expect(prepared.ok).toBe(true);
  });
});
