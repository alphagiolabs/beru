import { describe, it, expect } from "vitest";
import {
  resolveBatchWorkers,
  recommendBatchWorkers,
  AUTO_TARGET_WORKERS,
} from "../main/workerPolicy.js";

describe("workerPolicy", () => {
  it("explicit workers override auto caps", () => {
    expect(resolveBatchWorkers({
      hwEncoder: "h264_nvenc",
      jobCount: 10,
      explicitWorkers: 5,
    })).toBe(5);
  });

  it("balanced NVENC reaches 5 workers when job count allows", () => {
    expect(resolveBatchWorkers({
      hwEncoder: "h264_nvenc",
      jobCount: 8,
      mode: "balanced",
    })).toBe(AUTO_TARGET_WORKERS);
  });

  it("conservative NVENC stays at 2", () => {
    expect(resolveBatchWorkers({
      hwEncoder: "h264_nvenc",
      jobCount: 8,
      mode: "conservative",
    })).toBe(2);
  });

  it("Media Foundation always stays at 1", () => {
    expect(resolveBatchWorkers({
      hwEncoder: "h264_mf",
      jobCount: 10,
      mode: "balanced",
    })).toBe(1);
  });

  it("4K sources cap parallel workers at 2", () => {
    expect(resolveBatchWorkers({
      hwEncoder: "h264_nvenc",
      jobCount: 10,
      maxSourcePixels: 3840 * 2160,
      mode: "balanced",
    })).toBe(2);
  });

  it("recommendBatchWorkers returns structured hint", () => {
    const r = recommendBatchWorkers({
      hwEncoder: "h264_mf",
      jobCount: 5,
      mode: "balanced",
    });
    expect(r.recommended).toBe(1);
    expect(r.reason).toBe("mf_single");
  });
});