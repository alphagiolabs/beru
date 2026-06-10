import { describe, it, expect } from "vitest";
import {
  getLockedDimensions,
  hasLockedDimensions,
  mergeProbeIntoQueueItem,
} from "../src/utils/video-dimensions.js";

describe("video-dimensions", () => {
  describe("mergeProbeIntoQueueItem", () => {
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

    it("preserves video codec and frame rate", () => {
      const item = { width: 0, height: 0 };
      const merged = mergeProbeIntoQueueItem(item, {
        width: 1920,
        height: 1080,
        videoCodec: "h264",
        frameRate: 30,
        pixFmt: "yuv420p",
        duration: 120,
      });
      expect(merged.videoCodec).toBe("h264");
      expect(merged.frameRate).toBe(30);
      expect(merged.pixFmt).toBe("yuv420p");
      expect(merged.duration).toBe(120);
    });

    it("handles missing probe info gracefully", () => {
      const item = { width: 0, height: 0, sourceWidth: 0, sourceHeight: 0 };
      const merged = mergeProbeIntoQueueItem(item, {});
      expect(merged.sourceWidth).toBe(0);
      expect(merged.sourceHeight).toBe(0);
    });
  });

  describe("getLockedDimensions", () => {
    it("prefers sourceWidth/sourceHeight over width/height", () => {
      const item = { width: 1280, height: 720, sourceWidth: 1920, sourceHeight: 1080 };
      expect(getLockedDimensions(item)).toEqual({ width: 1920, height: 1080 });
    });

    it("falls back to width/height when source is not set", () => {
      const item = { width: 1280, height: 720, sourceWidth: 0, sourceHeight: 0 };
      expect(getLockedDimensions(item)).toEqual({ width: 1280, height: 720 });
    });

    it("returns zeros for null or missing item", () => {
      expect(getLockedDimensions(null)).toEqual({ width: 0, height: 0 });
      expect(getLockedDimensions(undefined)).toEqual({ width: 0, height: 0 });
    });
  });

  describe("hasLockedDimensions", () => {
    it("returns true when dimensions are positive", () => {
      expect(hasLockedDimensions({ sourceWidth: 1920, sourceHeight: 1080 })).toBe(true);
    });

    it("returns false when dimensions are zero", () => {
      expect(hasLockedDimensions({ sourceWidth: 0, sourceHeight: 0 })).toBe(false);
      expect(hasLockedDimensions({ width: 0, height: 0 })).toBe(false);
    });

    it("returns false for null item", () => {
      expect(hasLockedDimensions(null)).toBe(false);
    });
  });
});
