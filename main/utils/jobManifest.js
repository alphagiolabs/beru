import { normalizeManifest } from "../../shared/job-manifest.js";

export function unwrapJobManifest(payload) {
  try {
    return normalizeManifest(payload);
  } catch (error) {
    return { jobs: [], manifest: null, error: error.message };
  }
}
