import { beforeEach, describe, expect, it } from "vitest";
import {
  captureProcessingPreparation,
  cancelProcessingPreparation,
  isProcessingPreparationCurrent,
} from "../main/utils/process-preparation.js";

beforeEach(() => cancelProcessingPreparation());

describe("processing preparation ownership", () => {
  it("keeps pending work current when another preparation is captured", () => {
    const first = captureProcessingPreparation("editor:export");
    const second = captureProcessingPreparation("editor:export");
    const batch = captureProcessingPreparation();
    expect(isProcessingPreparationCurrent(first)).toBe(true);
    expect(isProcessingPreparationCurrent(second)).toBe(true);
    expect(isProcessingPreparationCurrent(batch)).toBe(true);
  });

  it("cancels one owner without invalidating another owner or a batch", () => {
    const exported = captureProcessingPreparation("editor:export");
    const frame = captureProcessingPreparation("editor:frame");
    const batch = captureProcessingPreparation();
    cancelProcessingPreparation("editor:export");
    expect(isProcessingPreparationCurrent(exported)).toBe(false);
    expect(isProcessingPreparationCurrent(frame)).toBe(true);
    expect(isProcessingPreparationCurrent(batch)).toBe(true);
    const nextExport = captureProcessingPreparation("editor:export");
    expect(isProcessingPreparationCurrent(nextExport)).toBe(true);
    cancelProcessingPreparation("editor:export");
    expect(isProcessingPreparationCurrent(nextExport)).toBe(false);
    expect(isProcessingPreparationCurrent(frame)).toBe(true);
  });

  it("invalidates every owner globally and never revives cancelled work", () => {
    const exported = captureProcessingPreparation("editor:export");
    cancelProcessingPreparation("editor:export");
    const nextExport = captureProcessingPreparation("editor:export");
    const frame = captureProcessingPreparation("editor:frame");
    const batch = captureProcessingPreparation();
    cancelProcessingPreparation();
    expect(isProcessingPreparationCurrent(exported)).toBe(false);
    expect(isProcessingPreparationCurrent(nextExport)).toBe(false);
    expect(isProcessingPreparationCurrent(frame)).toBe(false);
    expect(isProcessingPreparationCurrent(batch)).toBe(false);
    const currentExport = captureProcessingPreparation("editor:export");
    expect(isProcessingPreparationCurrent(currentExport)).toBe(true);
    cancelProcessingPreparation("editor:export");
    expect(isProcessingPreparationCurrent(exported)).toBe(false);
    expect(isProcessingPreparationCurrent(currentExport)).toBe(false);
  });
});
