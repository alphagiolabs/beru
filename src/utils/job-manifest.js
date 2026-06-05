export const JOB_MANIFEST_TYPE = "beru-job-manifest";
export const JOB_MANIFEST_VERSION = 1;

export function createJobManifest(jobs, meta = {}) {
  return {
    type: JOB_MANIFEST_TYPE,
    version: JOB_MANIFEST_VERSION,
    createdAt: meta.createdAt || new Date().toISOString(),
    profile: meta.profile || jobs?.[0]?.encode_profile || "balanced",
    jobs: Array.isArray(jobs) ? jobs : [],
  };
}

export function isJobManifest(payload) {
  return (
    payload &&
    typeof payload === "object" &&
    payload.type === JOB_MANIFEST_TYPE &&
    payload.version === JOB_MANIFEST_VERSION &&
    Array.isArray(payload.jobs)
  );
}
