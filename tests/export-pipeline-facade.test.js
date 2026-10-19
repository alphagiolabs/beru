import { describe, it, expect } from "vitest";
import {
  buildExportJob,
  applyJobProgressBatch,
  applyJobCancelled,
  abortProcessingQueue,
} from "../src/utils/export-pipeline.js";
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

  describe("applyJobCancelled", () => {
    it("leaves row idle and bumps progressDone", () => {
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
  });

  describe("abortProcessingQueue", () => {
    it("only resets processing rows", () => {
      const queue = [
        item({ status: "processing", progress: 30 }),
        item({ status: "done", progress: 100 }),
      ];
      const { queue: next, queueChanged } = abortProcessingQueue(queue);
      expect(queueChanged).toBe(true);
      expect(next[0]).toMatchObject({ status: "idle", progress: 0 });
      expect(next[1].status).toBe("done");
    });

    it("clears legacy Cancelled error rows but not real failures", () => {
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
  });
});
