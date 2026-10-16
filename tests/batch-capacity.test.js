import { describe, it, expect } from "vitest";
import { queueCapacityInput, capacityJobsSignature } from "../src/utils/batch-capacity.js";

describe("queueCapacityInput", () => {
  it("uses queue length and source pixels", () => {
    const input = queueCapacityInput(
      [
        { sourceWidth: 1920, sourceHeight: 1080, operations: [], videoCodec: "h264" },
        { width: 1280, height: 720, operations: [], videoCodec: "hevc", pixFmt: "yuv420p10le" },
      ],
      [],
    );
    expect(input.queueLength).toBe(2);
    expect(input.maxSourcePixels).toBe(1920 * 1080);
    expect(input.hasVideoFilters).toBe(false);
    expect(input.jobs).toEqual([
      { videoCodec: "h264", pixFmt: "", sourceWidth: 1920, sourceHeight: 1080 },
      { videoCodec: "hevc", pixFmt: "yuv420p10le", sourceWidth: 1280, sourceHeight: 720 },
    ]);
  });

  it("flags filters when an existing item gains operations", () => {
    const before = queueCapacityInput([{ width: 1920, height: 1080, operations: [] }], []);
    const after = queueCapacityInput(
      [{ width: 1920, height: 1080, operations: [{ mode: "blur" }] }],
      [],
    );
    expect(before.hasVideoFilters).toBe(false);
    expect(after.hasVideoFilters).toBe(true);
    expect(after.queueLength).toBe(before.queueLength);
    expect(after.maxSourcePixels).toBe(before.maxSourcePixels);
  });

  it("flags filters from template regions even with an empty queue", () => {
    const input = queueCapacityInput([], [{ id: "r1" }]);
    expect(input.queueLength).toBe(0);
    expect(input.hasVideoFilters).toBe(true);
  });

  it.each([
    { transform: { rotation: 90 } },
    { transform: { outputHeight: 720 } },
    { transform: { outputWidth: 3840, outputHeight: 2160, fitMode: "pad" } },
    { transform: { outputWidth: 1080, outputHeight: 1920, fitMode: "crop" } },
    { timing: { rate: 2 } },
    { timing: { repeatCount: 2 } },
    { trimStart: 1 },
  ])("refreshes capacity for an encode edit without Operations: %j", (patch) => {
    const base = { width: 1920, height: 1080, duration: 10, operations: [] };
    const edited = { ...base, ...patch };
    expect(queueCapacityInput([edited]).hasVideoFilters).toBe(true);
    expect(capacityJobsSignature([edited])).not.toBe(capacityJobsSignature([base]));
  });

  it("tracks an enabled watermark and preserves identity for a resize that cannot enlarge", () => {
    const queue = [
      { width: 1920, height: 1080, operations: [], transform: { outputHeight: 2160 } },
    ];
    expect(queueCapacityInput(queue).hasVideoFilters).toBe(false);
    expect(queueCapacityInput(queue, [], { enabled: true }).hasVideoFilters).toBe(true);
    expect(capacityJobsSignature(queue, [], { enabled: true })).not.toBe(
      capacityJobsSignature(queue),
    );
  });
});
