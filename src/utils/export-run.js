import { hasVideoDimensions, listVideosMissingBatchText } from "./batch-process.js";
import { createJobManifest } from "./job-manifest.js";
import {
  buildExportJob,
  buildExportJobs,
  createBatchStartPatch,
  createSingleStartPatch,
} from "./export-pipeline.js";

function validateBatchReady({ queue, templateRegions = [], getCellText }) {
  const list = Array.isArray(queue) ? queue : [];
  const missingDims = list.filter((q) => !hasVideoDimensions(q));
  if (missingDims.length > 0) {
    return {
      ok: false,
      code: "missing_dimensions",
      details: { missing: missingDims, count: missingDims.length },
    };
  }

  if (templateRegions?.length > 0 && typeof getCellText === "function") {
    const missingText = listVideosMissingBatchText(list, templateRegions, getCellText);
    if (missingText.length > 0) {
      return {
        ok: false,
        code: "missing_batch_text",
        details: { missing: missingText, count: missingText.length },
      };
    }
  }

  return { ok: true };
}

export function prepareRun({
  queue,
  videoIdx = null,
  templateRegions = [],
  getCellText,
  outputPaths = [],
  encodeProfile = "balanced",
  watermark = null,
  exportSignatures = {},
}) {
  const list = Array.isArray(queue) ? queue : [];
  const single = videoIdx != null;

  const buildOne = (item, i) =>
    buildExportJob(item, i, {
      encodeProfile,
      outputPath: outputPaths[i] ?? null,
      watermark,
    });

  if (single) {
    if (!Number.isInteger(videoIdx) || videoIdx < 0 || videoIdx >= list.length) {
      return { ok: false, code: "invalid_video", error: "Video inválido" };
    }
    const job = buildOne(list[videoIdx], videoIdx);
    if (!job) {
      return { ok: false, code: "no_job", error: "No se pudo construir el job" };
    }
    const signatures = { ...exportSignatures, [videoIdx]: JSON.stringify(job) };
    return {
      ok: true,
      jobs: [job],
      manifest: createJobManifest([job]),
      signatures,
      startPatch: {
        ...createSingleStartPatch({ queue: list, videoIdx }),
        exportSignatures: signatures,
      },
    };
  }

  const validation = validateBatchReady({ queue: list, templateRegions, getCellText });
  if (!validation.ok) return validation;

  const jobs = buildExportJobs(list, buildOne);
  if (jobs.length === 0) return { ok: false, code: "no_jobs" };

  const signatures = Object.fromEntries(jobs.map((job) => [job.id, JSON.stringify(job)]));
  return {
    ok: true,
    jobs,
    manifest: createJobManifest(jobs),
    signatures,
    startPatch: {
      ...createBatchStartPatch({ queue: list, jobCount: jobs.length }),
      exportSignatures: signatures,
    },
  };
}
