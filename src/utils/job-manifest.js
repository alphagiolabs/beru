import { JOB_MANIFEST_TYPE, JOB_MANIFEST_VERSION } from "../../shared/job-manifest.js";

export { JOB_MANIFEST_TYPE, JOB_MANIFEST_VERSION };

export function createJobManifest(jobs, meta = {}) {
  return {
    type: JOB_MANIFEST_TYPE,
    version: JOB_MANIFEST_VERSION,
    createdAt: meta.createdAt || new Date().toISOString(),
    jobs: Array.isArray(jobs) ? jobs : [],
  };
}

export function isJobManifest(payload) {
  if (!payload || typeof payload !== "object") return false;
  return (
    payload.type === JOB_MANIFEST_TYPE &&
    payload.version === JOB_MANIFEST_VERSION &&
    Array.isArray(payload.jobs)
  );
}
