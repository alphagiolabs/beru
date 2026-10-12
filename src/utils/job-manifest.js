import { buildJobManifest } from "../../shared/build-job-manifest.js";

export function createJobManifest(jobs, meta = {}) {
  return buildJobManifest(jobs, meta.createdAt);
}
