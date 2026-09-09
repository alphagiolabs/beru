import { JOB_MANIFEST_TYPE, JOB_MANIFEST_VERSION } from "../../shared/job-manifest.js";

export function unwrapJobManifest(payload) {
  if (Array.isArray(payload)) {
    return { jobs: payload, manifest: null, warning: "legacy-array" };
  }

  if (!payload || typeof payload !== "object") {
    return { jobs: [], manifest: null, error: "Payload de procesamiento inválido" };
  }

  if (payload.type !== JOB_MANIFEST_TYPE) {
    return { jobs: [], manifest: null, error: "Tipo de manifiesto de procesamiento inválido" };
  }

  if (payload.version !== JOB_MANIFEST_VERSION) {
    return {
      jobs: [],
      manifest: null,
      error: `Versión de manifiesto no soportada: ${payload.version}`,
    };
  }

  if (!Array.isArray(payload.jobs)) {
    return { jobs: [], manifest: null, error: "El manifiesto no contiene jobs válidos" };
  }

  return { jobs: payload.jobs, manifest: payload, warning: null };
}

export function createProcessorManifest(manifest, jobs) {
  const safeJobs = (Array.isArray(jobs) ? jobs : []).map((job, index) => {
    if (!job || typeof job !== "object") return job;
    // Per-job events (complete/progress/error) and the cancel output snapshot
    // key by integer positions; a non-integer id would be surfaced as a global
    // error and completed outputs would not be marked for cancel cleanup.
    return Number.isInteger(job.id) ? job : { ...job, id: index };
  });
  return {
    type: JOB_MANIFEST_TYPE,
    version: JOB_MANIFEST_VERSION,
    createdAt: manifest?.createdAt || new Date().toISOString(),
    jobs: safeJobs,
  };
}
