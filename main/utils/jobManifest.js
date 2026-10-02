import {
  JOB_MANIFEST_TYPE,
  JOB_MANIFEST_VERSION,
  normalizeManifest,
} from "../../shared/job-manifest.js";

export function unwrapJobManifest(payload) {
  try {
    return normalizeManifest(payload);
  } catch (error) {
    return { jobs: [], manifest: null, error: error.message };
  }
}

export function createProcessorManifest(manifest, jobs) {
  return normalizeManifest({
    type: JOB_MANIFEST_TYPE,
    version: JOB_MANIFEST_VERSION,
    createdAt: manifest?.createdAt || new Date().toISOString(),
    jobs: Array.isArray(jobs) ? jobs : [],
  }).manifest;
}
