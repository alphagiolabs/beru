import {
  JOB_MANIFEST_TYPE,
  JOB_MANIFEST_VERSION,
  normalizeManifest,
} from "../../shared/job-manifest.js";

export function createJobManifest(jobs, meta = {}) {
  return normalizeManifest({
    type: JOB_MANIFEST_TYPE,
    version: JOB_MANIFEST_VERSION,
    createdAt: meta.createdAt || new Date().toISOString(),
    jobs: Array.isArray(jobs) ? jobs : [],
  }).manifest;
}
