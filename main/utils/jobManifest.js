import { normalizeManifest } from "../../shared/job-manifest.js";
import { buildJobManifest } from "../../shared/build-job-manifest.js";

export function unwrapJobManifest(payload) {
  try {
    return normalizeManifest(payload);
  } catch (error) {
    return { jobs: [], manifest: null, error: error.message };
  }
}

export function createProcessorManifest(manifest, jobs) {
  return buildJobManifest(jobs, manifest?.createdAt);
}
