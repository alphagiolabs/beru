import { describe, it, expect } from "vitest";
import { getLockedDimensions, mergeProbeIntoQueueItem } from "../src/utils/video-dimensions.js";

describe("video-dimensions", () => {
  it("locks source dimensions on first probe", () => {
    const item = { width: 0, height: 0, sourceWidth: 0, sourceHeight: 0 };
    const merged = mergeProbeIntoQueueItem(item, { width: 1920, height: 1080 });
    expect(merged.sourceWidth).toBe(1920);
    expect(merged.sourceHeight).toBe(1080);
    expect(getLockedDimensions(merged)).toEqual({ width: 1920, height: 1080 });
  });

  it("does not overwrite locked source on later probes", () => {
    const item = {
      width: 1920,
      height: 1080,
      sourceWidth: 1920,
      sourceHeight: 1080,
    };
    const merged = mergeProbeIntoQueueItem(item, { width: 1280, height: 720 });
    expect(merged.sourceWidth).toBe(1920);
    expect(merged.sourceHeight).toBe(1080);
    expect(getLockedDimensions(merged)).toEqual({ width: 1920, height: 1080 });
  });

  it("keeps audio channel metadata from probes", () => {
    const item = { width: 0, height: 0, audioChannels: 0 };
    const merged = mergeProbeIntoQueueItem(item, {
      width: 1920,
      height: 1080,
      audioCodec: "aac",
      audioChannels: 6,
    });

    expect(merged.audioCodec).toBe("aac");
    expect(merged.audioChannels).toBe(6);
  });
});
