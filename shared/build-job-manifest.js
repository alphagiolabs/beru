import { JOB_MANIFEST_TYPE, JOB_MANIFEST_VERSION, normalizeManifest } from "./job-manifest.js";

export function buildJobManifest(jobs, createdAt) {
  return normalizeManifest({
    type: JOB_MANIFEST_TYPE,
    version: JOB_MANIFEST_VERSION,
    createdAt: createdAt || new Date().toISOString(),
    jobs: Array.isArray(jobs) ? jobs : [],
  }).manifest;
}
