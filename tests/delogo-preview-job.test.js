import { describe, expect, it } from "vitest";
import { buildLogoPreviewJob } from "../src/utils/delogo-ops.js";

const baseJob = {
  input_path: "C:/video.mp4",
  width: 640,
  height: 360,
  operations: [
    { mode: "text", text: "Excel title", region: { x: 20, y: 20, w: 200, h: 40 } },
    { mode: "delogo", delogo_method: "blur", region: { x: 500, y: 30, w: 60, h: 30 } },
  ],
};

describe("logo preview job", () => {
  it("adds a draft after applied operations without changing the queue or text payload", () => {
    const original = structuredClone(baseJob);
    const region = { x: 0.25, y: 0.2, w: 0.2, h: 0.1 };
    const job = buildLogoPreviewJob(baseJob, {
      mode: "delogo",
      region,
      delogoMethod: "blur",
      blurStrength: 37,
      edgeFeather: 8,
    });

    expect(baseJob).toEqual(original);
    expect(job.operations.slice(0, 2)).toEqual(baseJob.operations);
    expect(job.operations[2]).toMatchObject({
      mode: "delogo",
      delogo_method: "blur",
      blur_strength: 37,
      edge_feather: 8,
      region: { x: 160, y: 72, w: 128, h: 36 },
    });
  });

  it("converts crop drafts and rejects unusable regions", () => {
    const job = buildLogoPreviewJob(baseJob, {
      mode: "crop",
      region: { x: 0.1, y: 0.2, w: 0.8, h: 0.7 },
    });
    expect(job.operations.at(-1)).toMatchObject({
      mode: "crop",
      region: { x: 64, y: 72, w: 512, h: 252 },
    });
    expect(
      buildLogoPreviewJob(baseJob, { mode: "crop", region: { x: 0, y: 0, w: 0, h: 0 } }),
    ).toEqual(baseJob);
  });

  it("includes the primary blur tool draft", () => {
    const job = buildLogoPreviewJob(baseJob, {
      mode: "blur",
      blurStrength: 42,
      region: { x: 0, y: 0, w: 0.1, h: 0.1 },
    });
    expect(job.operations.at(-1)).toMatchObject({
      mode: "blur",
      blur_strength: 42,
      region: { x: 0, y: 0, w: 64, h: 36 },
    });
  });
});
