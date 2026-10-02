import { describe, it, expect } from "vitest";
import os from "os";
import {
  resolveBatchWorkers,
  recommendBatchWorkers,
  estimateJobRamMb,
  memoryCapWorkers,
  AUTO_TARGET_WORKERS,
} from "../main/workerPolicy.js";

const PLENTY_OF_RAM_MB = 64 * 1024;

describe("workerPolicy", () => {
  it("explicit workers override auto caps", () => {
    expect(
      resolveBatchWorkers({
        hwEncoder: "h264_nvenc",
        jobCount: 10,
        explicitWorkers: 5,
        availableRamMb: PLENTY_OF_RAM_MB,
      }),
    ).toBe(5);
  });

  it("balanced NVENC reaches 5 workers when job count allows", () => {
    expect(
      resolveBatchWorkers({
        hwEncoder: "h264_nvenc",
        jobCount: 8,
        mode: "balanced",
        availableRamMb: PLENTY_OF_RAM_MB,
      }),
    ).toBe(AUTO_TARGET_WORKERS);
  });

  it("conservative NVENC stays at 2", () => {
    expect(
      resolveBatchWorkers({
        hwEncoder: "h264_nvenc",
        jobCount: 8,
        mode: "conservative",
        availableRamMb: PLENTY_OF_RAM_MB,
      }),
    ).toBe(2);
  });

  it("Media Foundation always stays at 1", () => {
    expect(
      resolveBatchWorkers({
        hwEncoder: "h264_mf",
        jobCount: 10,
        mode: "balanced",
        availableRamMb: PLENTY_OF_RAM_MB,
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
        availableRamMb: PLENTY_OF_RAM_MB,
      }),
    ).toBe(2);
  });

  it("1080p quality batches with filters scale workers with cores", () => {
    const cpus = os.cpus()?.length || 4;
    const filterCap = Math.max(3, Math.min(6, cpus - 4));
    expect(
      resolveBatchWorkers({
        hwEncoder: "h264_nvenc",
        jobCount: 8,
        maxSourcePixels: 1920 * 1080,
        mode: "balanced",
        hasVideoFilters: true,
        encodeProfile: "quality",
        availableRamMb: PLENTY_OF_RAM_MB,
      }),
    ).toBe(Math.min(5, filterCap));
  });

  it("quality profile reports GPU policy when a hardware encoder exists", () => {
    const r = recommendBatchWorkers({
      hwEncoder: "h264_nvenc",
      jobCount: 8,
      mode: "balanced",
      hasVideoFilters: true,
      encodeProfile: "quality",
      availableRamMb: PLENTY_OF_RAM_MB,
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
      availableRamMb: PLENTY_OF_RAM_MB,
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
      availableRamMb: PLENTY_OF_RAM_MB,
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
        availableRamMb: PLENTY_OF_RAM_MB,
      }),
    ).toBe(4);
  });

  it("recommendBatchWorkers returns structured hint", () => {
    const r = recommendBatchWorkers({
      hwEncoder: "h264_mf",
      jobCount: 5,
      mode: "balanced",
      availableRamMb: PLENTY_OF_RAM_MB,
    });
    expect(r.recommended).toBe(1);
    expect(r.reason).toBe("mf_single");
  });

  it("memory cap clamps balanced NVENC when RAM is tight", () => {
    expect(
      resolveBatchWorkers({
        hwEncoder: "h264_nvenc",
        jobCount: 8,
        mode: "balanced",
        availableRamMb: 512,
      }),
    ).toBe(1);
    expect(
      resolveBatchWorkers({
        hwEncoder: "h264_nvenc",
        jobCount: 8,
        mode: "balanced",
        availableRamMb: 1024,
      }),
    ).toBe(3);
  });

  it("memory cap uses per-job estimates when jobEntries are provided", () => {
    expect(
      resolveBatchWorkers({
        hwEncoder: null,
        jobCount: 8,
        mode: "balanced",
        encodeProfile: "balanced",
        jobEntries: [
          { videoCodec: "hevc", pixFmt: "yuv420p10le", sourceWidth: 3840, sourceHeight: 2160 },
        ],
        availableRamMb: 1920,
      }),
    ).toBe(1);
  });

  it("estimateJobRamMb mirrors the processor math", () => {
    expect(estimateJobRamMb({})).toBe(512);
    expect(
      estimateJobRamMb({
        hwEncoder: "h264_nvenc",
        hasVideoFilters: true,
        encodeProfile: "quality",
        sourcePixels: 1920 * 1080,
      }),
    ).toBe(576);
    expect(
      estimateJobRamMb({
        hwEncoder: null,
        hasVideoFilters: true,
        encodeProfile: "quality",
        sourcePixels: 3840 * 2160,
      }),
    ).toBe(3362); // Floor after each multiplier, as the processor does.
    expect(
      memoryCapWorkers({
        hwEncoder: null,
        hasVideoFilters: true,
        encodeProfile: "quality",
        maxSourcePixels: 3840 * 2160,
        desiredWorkers: 8,
        availableRamMb: 8405,
      }),
    ).toBe(2);
  });

  it("does not admit two measured 4K HEVC10 filtered QSV jobs into 2600 MiB", () => {
    const input = {
      hwEncoder: "h264_qsv",
      jobCount: 2,
      maxSourcePixels: 3840 * 2160,
      hasVideoFilters: true,
      encodeProfile: "balanced",
      jobEntries: [
        { videoCodec: "hevc", pixFmt: "yuv420p10le", sourceWidth: 3840, sourceHeight: 2160 },
      ],
    };
    expect(resolveBatchWorkers({ ...input, availableRamMb: 2600 })).toBe(1);
    expect(resolveBatchWorkers({ ...input, availableRamMb: 4000 })).toBe(2);
  });
});
