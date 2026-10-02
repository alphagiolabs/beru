import { describe, it, expect } from "vitest";
import {
  buildExportJob,
  buildExportJobs,
  applyJobProgressBatch,
  applyJobDone,
  applyJobError,
  applyJobCancelled,
  resetQueueForRun,
  abortProcessingQueue,
  createBatchStartPatch,
  createSingleStartPatch,
} from "../src/utils/export-pipeline.js";
import { prepareRun } from "../src/utils/export-run.js";
import { normalizeJob } from "../shared/job-manifest.js";
import { MINIMAL_JOB_NORMALIZED } from "./fixtures/job-manifest.js";

function item(overrides = {}) {
  return {
    path: "C:\\videos\\a.mp4",
    filename: "a.mp4",
    width: 1920,
    height: 1080,
    duration: 10,
    videoCodec: "h264",
    pixFmt: "yuv420p",
    frameRate: 30,
    audioCodec: "aac",
    audioChannels: 2,
    operations: [],
    status: "idle",
    progress: 0,
    error: null,
    ...overrides,
  };
}

describe("export-pipeline", () => {
  describe("buildExportJob", () => {
    it("builds a python job payload from a queue item", () => {
      const job = buildExportJob(
        item({
          operations: [
            { mode: "blur", region: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, blurStrength: 15 },
          ],
        }),
        2,
        {
          encodeProfile: "fast",
          outputPath: "C:\\out\\a_beru.mp4",
          watermark: null,
        },
      );
      expect(job).toMatchObject({
        id: 2,
        input_path: "C:\\videos\\a.mp4",
        output_path: "C:\\out\\a_beru.mp4",
        width: 1920,
        height: 1080,
        encode_profile: "fast",
        watermark: null,
      });
      expect(job.operations).toHaveLength(1);
      expect(job.operations[0].mode).toBe("blur");
      expect(job.operations[0].region).toEqual({ x: 192, y: 108, w: 384, h: 216 });
    });

    it("returns null for missing item", () => {
      expect(buildExportJob(null, 0, { encodeProfile: "balanced", outputPath: "x" })).toBeNull();
    });

    it("emits a normalized job (schema defaults come from normalizeJob, not the builder)", () => {
      const job = buildExportJob(item(), 0, { outputPath: "C:\\out\\a.mp4" });
      expect(job).toEqual(normalizeJob(job));
      expect(job).toMatchObject({
        id: 0,
        pix_fmt: "yuv420p",
        encode_profile: "balanced",
        trim_start: 0,
        trim_end: null,
        watermark: null,
        video_info_probed: true,
      });
    });

    it("an unprobed item yields a job the processor still has to probe", () => {
      const bare = item({
        duration: 0,
        videoCodec: undefined,
        pixFmt: undefined,
        frameRate: undefined,
        audioCodec: undefined,
        audioChannels: undefined,
      });
      const job = buildExportJob(bare, 0, { outputPath: "C:\\out\\b.mp4" });
      expect(job).toEqual({
        ...MINIMAL_JOB_NORMALIZED,
        input_path: "C:\\videos\\a.mp4",
        output_path: "C:\\out\\b.mp4",
        width: 1920,
        height: 1080,
        source_width: 1920,
        source_height: 1080,
      });
    });

    it("forwards the enabled watermark into the run's job", () => {
      const wm = { enabled: true, text: "x" };
      const job = prepareRun({
        queue: [item()],
        outputPaths: ["C:\\out\\a.mp4"],
        encodeProfile: "balanced",
        watermark: wm,
      }).jobs[0];
      expect(job.watermark).toBe(wm);
    });
  });

  describe("buildExportJobs", () => {
    it("maps queue items via ctxForItem and drops nulls", () => {
      const queue = [item(), item({ path: "C:\\videos\\b.mp4" })];
      const jobs = buildExportJobs(queue, (qItem, index) =>
        buildExportJob(qItem, index, {
          encodeProfile: "balanced",
          outputPath: `C:\\out\\${index}.mp4`,
          watermark: null,
        }),
      );
      expect(jobs).toHaveLength(2);
      expect(jobs[1].id).toBe(1);
    });
  });

  describe("applyJobProgressBatch", () => {
    it("updates queue progress when progressMap is false", () => {
      const queue = [item(), item({ path: "b.mp4" })];
      const jobProgress = {};
      const result = applyJobProgressBatch({
        queue,
        jobProgress,
        messages: [{ index: 0, percent: 42 }],
        progressMap: false,
      });
      expect(result.queue[0]).toMatchObject({ status: "processing", progress: 42 });
      expect(result.queue).not.toBe(queue);
      expect(result.jobProgress).toBe(jobProgress);
    });

    it("keeps queue referentially stable when nothing changes", () => {
      const queue = [item({ status: "processing", progress: 10 })];
      const result = applyJobProgressBatch({
        queue,
        jobProgress: {},
        messages: [{ index: 0, percent: 10 }],
        progressMap: false,
      });
      expect(result.queue).toBe(queue);
    });

    it("writes jobProgress map and flips status only when progressMap is true", () => {
      const queue = [item()];
      const result = applyJobProgressBatch({
        queue,
        jobProgress: {},
        messages: [{ index: 0, percent: 55 }],
        progressMap: true,
      });
      expect(result.queue[0].status).toBe("processing");
      expect(result.queue[0].progress).toBe(0);
      expect(result.jobProgress[0]).toBe(55);
    });

    it("skips done/error items", () => {
      const queue = [item({ status: "done", progress: 100 })];
      const result = applyJobProgressBatch({
        queue,
        jobProgress: { 0: 100 },
        messages: [{ index: 0, percent: 50 }],
        progressMap: true,
      });
      expect(result.queue).toBe(queue);
      expect(result.jobProgress).toEqual({ 0: 100 });
    });
  });

  describe("applyJobDone / applyJobError", () => {
    it("marks done and bumps progressDone", () => {
      const queue = [item({ status: "processing" }), item()];
      const result = applyJobDone({
        queue,
        jobProgress: { 0: 80, 1: 10 },
        progressDone: 0,
        progressTotal: 2,
        msg: { index: 0 },
        progressMap: true,
      });
      expect(result.queue[0]).toMatchObject({ status: "done", progress: 100, error: null });
      expect(result.progressDone).toBe(1);
      expect(result.jobProgress[0]).toBe(100);
      expect(result.jobProgress[1]).toBe(10);
    });

    it("marks error and deletes jobProgress key", () => {
      const queue = [item(), item({ status: "processing" })];
      const result = applyJobError({
        queue,
        jobProgress: { 0: 10, 1: 40 },
        progressDone: 0,
        progressTotal: 2,
        msg: { index: 1, error: "boom" },
        progressMap: true,
      });
      expect(result.queue[1]).toMatchObject({ status: "error", error: "boom" });
      expect(result.jobProgress).toEqual({ 0: 10 });
      expect(result.progressDone).toBe(1);
    });

    it("applyJobCancelled leaves row idle and bumps progressDone", () => {
      const queue = [item(), item({ status: "processing", progress: 40 })];
      const result = applyJobCancelled({
        queue,
        jobProgress: { 0: 10, 1: 40 },
        progressDone: 0,
        progressTotal: 2,
        msg: { index: 1 },
        progressMap: true,
      });
      expect(result.queue[1]).toMatchObject({ status: "idle", progress: 0, error: null });
      expect(result.jobProgress).toEqual({ 0: 10 });
      expect(result.progressDone).toBe(1);
    });

    it("real applyJobError with non-Cancelled message stays error", () => {
      const queue = [item({ status: "processing" })];
      const result = applyJobError({
        queue,
        jobProgress: { 0: 50 },
        progressDone: 0,
        progressTotal: 1,
        msg: { index: 0, error: "FFmpeg failed" },
        progressMap: true,
      });
      expect(result.queue[0]).toMatchObject({ status: "error", error: "FFmpeg failed" });
    });

    it("returns empty patch for invalid index", () => {
      expect(
        applyJobDone({
          queue: [item()],
          jobProgress: {},
          progressDone: 0,
          progressTotal: 1,
          msg: { index: 9 },
          progressMap: false,
        }),
      ).toEqual({});
    });
  });

  describe("reset / abort / start patches", () => {
    it("resetQueueForRun clears statuses", () => {
      const queue = [item({ status: "done", progress: 100, error: "x" })];
      expect(resetQueueForRun(queue)[0]).toMatchObject({
        status: "idle",
        progress: 0,
        error: null,
      });
    });

    it("abortProcessingQueue only resets processing rows", () => {
      const queue = [
        item({ status: "processing", progress: 30 }),
        item({ status: "done", progress: 100 }),
      ];
      const { queue: next, queueChanged } = abortProcessingQueue(queue);
      expect(queueChanged).toBe(true);
      expect(next[0]).toMatchObject({ status: "idle", progress: 0 });
      expect(next[1].status).toBe("done");
    });

    it("abort clears legacy Cancelled error rows but not real failures", () => {
      const queue = [
        item({ status: "error", error: "Cancelled", progress: 20 }),
        item({ status: "error", error: "FFmpeg failed", progress: 10 }),
        item({ status: "done", progress: 100 }),
      ];
      const { queue: next, queueChanged } = abortProcessingQueue(queue);
      expect(queueChanged).toBe(true);
      expect(next[0]).toMatchObject({ status: "idle", progress: 0, error: null });
      expect(next[1]).toMatchObject({ status: "error", error: "FFmpeg failed" });
      expect(next[2].status).toBe("done");
    });

    it("createBatchStartPatch prepares batch state", () => {
      const queue = [item({ status: "done", progress: 100 })];
      const patch = createBatchStartPatch({ queue, jobCount: 1 });
      expect(patch.isProcessing).toBe(true);
      expect(patch.progressTotal).toBe(1);
      expect(patch.progressDone).toBe(0);
      expect(patch.jobProgress).toEqual({});
      expect(patch.queue[0].status).toBe("idle");
    });

    it("createSingleStartPatch marks one item processing", () => {
      const queue = [item(), item({ path: "b.mp4" })];
      const patch = createSingleStartPatch({ queue, videoIdx: 1 });
      expect(patch.isProcessing).toBe(true);
      expect(patch.progressTotal).toBe(1);
      expect(patch.queue[1]).toMatchObject({ status: "processing", progress: 0, error: null });
      expect(patch.queue[0].status).toBe("idle");
    });
  });
});
