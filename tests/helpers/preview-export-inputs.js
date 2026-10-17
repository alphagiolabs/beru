import { readFileSync } from "node:fs";
import { buildExportJob } from "../../src/utils/export-pipeline.js";
import { operationsToJobPayload } from "../../src/utils/operation.js";
import { transformJobFields } from "../../src/utils/output-geometry.js";

export const readContract = (name) =>
  JSON.parse(readFileSync(`resources/${name}-fixtures.json`, "utf8"));

export function previewExportInputs() {
  const classify = readContract("job-classify");
  const crop = readContract("crop-output");
  return {
    geometry: readContract("output-geometry").cases.map((c) => transformJobFields(c.transform)),
    crop: crop.cases.map((c) => operationsToJobPayload(c.operations, crop.dims.w, crop.dims.h)),
    classify: classify.cases.map((c) =>
      buildExportJob({ ...classify.base, ...c.item }, 0, {
        outputPath: "output.mp4",
        watermark: c.watermark,
      }),
    ),
  };
}
