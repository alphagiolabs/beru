import { describe, it, expect } from "vitest";
import {
  resolveBatchWorkers,
  recommendBatchWorkers,
  AUTO_TARGET_WORKERS,
} from "../main/workerPolicy.js";

describe("workerPolicy", () => {
  it("explicit workers override auto caps", () => {
    expect(
      resolveBatchWorkers({
        hwEncoder: "h264_nvenc",
        jobCount: 10,
        explicitWorkers: 5,
      }),
    ).toBe(5);
  });

  it("balanced NVENC reaches 5 workers when job count allows", () => {
    expect(
      resolveBatchWorkers({
        hwEncoder: "h264_nvenc",
        jobCount: 8,
        mode: "balanced",
      }),
    ).toBe(AUTO_TARGET_WORKERS);
  });

  it("conservative NVENC stays at 2", () => {
    expect(
      resolveBatchWorkers({
        hwEncoder: "h264_nvenc",
        jobCount: 8,
        mode: "conservative",
      }),
    ).toBe(2);
  });

  it("Media Foundation always stays at 1", () => {
    expect(
      resolveBatchWorkers({
        hwEncoder: "h264_mf",
        jobCount: 10,
        mode: "balanced",
      }),
    ).toBe(1);
  });

  it("4K sources cap parallel workers at 2", () => {
    expect(
      resolveBatchWorkers({
        hwEncoder: "h264_nvenc",
        jobCount: 10,
        maxSourcePixels: 3840 * 2160,
        mode: "balanced",
      }),
    ).toBe(2);
  });

  it("1080p quality batches with filters use balanced GPU caps", () => {
    expect(
      resolveBatchWorkers({
        hwEncoder: "h264_nvenc",
        jobCount: 8,
        maxSourcePixels: 1920 * 1080,
        mode: "balanced",
        hasVideoFilters: true,
        encodeProfile: "quality",
      }),
    ).toBe(3);
  });

  it("quality profile reports GPU policy when a hardware encoder exists", () => {
    const r = recommendBatchWorkers({
      hwEncoder: "h264_nvenc",
      jobCount: 8,
      mode: "balanced",
      hasVideoFilters: true,
      encodeProfile: "quality",
    });

    expect(r.encoder).toBe("h264_nvenc");
    expect(r.reason).toBe("gpu_balanced");
    expect(r.recommended).toBe(AUTO_TARGET_WORKERS);
  });

  it("quality profile keeps the CPU filter cap when no hardware encoder exists", () => {
    const r = recommendBatchWorkers({
      hwEncoder: null,
      jobCount: 8,
      mode: "balanced",
      hasVideoFilters: true,
      encodeProfile: "quality",
    });

    expect(r.encoder).toBeNull();
    expect(r.reason).toBe("cpu_balanced");
    expect(r.recommended).toBe(2);
  });

  it("U Quality stays on the CPU path even when a hardware encoder exists", () => {
    const r = recommendBatchWorkers({
      hwEncoder: "h264_nvenc",
      jobCount: 8,
      mode: "balanced",
      hasVideoFilters: true,
      encodeProfile: "uquality",
    });

    expect(r.encoder).toBeNull();
    expect(r.reason).toBe("cpu_balanced");
    expect(r.recommended).toBe(2);
  });

  it("manual worker count still overrides memory-aware automatic caps", () => {
    expect(
      resolveBatchWorkers({
        hwEncoder: "h264_nvenc",
        jobCount: 8,
        maxSourcePixels: 1920 * 1080,
        mode: "balanced",
        hasVideoFilters: true,
        encodeProfile: "quality",
        explicitWorkers: 4,
      }),
    ).toBe(4);
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
