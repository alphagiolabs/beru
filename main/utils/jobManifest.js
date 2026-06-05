export const JOB_MANIFEST_TYPE = "beru-job-manifest";
export const JOB_MANIFEST_VERSION = 1;

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
  return {
    type: JOB_MANIFEST_TYPE,
    version: JOB_MANIFEST_VERSION,
    createdAt: manifest?.createdAt || new Date().toISOString(),
    profile: manifest?.profile || jobs?.[0]?.encode_profile || "balanced",
    jobs,
  };
}
