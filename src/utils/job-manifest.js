export const JOB_MANIFEST_TYPE = "beru-job-manifest";
export const JOB_MANIFEST_VERSION = 1;

export function createJobManifest(jobs, meta = {}) {
  return {
    type: JOB_MANIFEST_TYPE,
    version: JOB_MANIFEST_VERSION,
    createdAt: meta.createdAt || new Date().toISOString(),
    // Encode profile is resolved per-job by the Python processor (with
    // BERU_ENCODE_PROFILE fallback). No manifest-level profile is emitted —
    // Python never reads it.
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
