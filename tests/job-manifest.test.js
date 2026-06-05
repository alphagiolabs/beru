import { describe, expect, it } from "vitest";
import {
  createJobManifest,
  isJobManifest,
  JOB_MANIFEST_TYPE,
  JOB_MANIFEST_VERSION,
} from "../src/utils/job-manifest.js";
import { unwrapJobManifest } from "../main/utils/jobManifest.js";

describe("job manifest", () => {
  it("wraps renderer jobs in a versioned manifest", () => {
    const manifest = createJobManifest([{ id: 7, encode_profile: "quality" }], {
      createdAt: "2026-06-05T00:00:00.000Z",
    });

    expect(manifest).toEqual({
      type: JOB_MANIFEST_TYPE,
      version: JOB_MANIFEST_VERSION,
      createdAt: "2026-06-05T00:00:00.000Z",
      profile: "quality",
      jobs: [{ id: 7, encode_profile: "quality" }],
    });
    expect(isJobManifest(manifest)).toBe(true);
  });

  it("rejects non-manifest payloads", () => {
    expect(isJobManifest([{ id: 1 }])).toBe(false);
    expect(isJobManifest({ type: JOB_MANIFEST_TYPE, version: 999, jobs: [] })).toBe(false);
  });

  it("main unwraps new manifests and keeps legacy arrays compatible", () => {
    expect(unwrapJobManifest([{ id: 1 }])).toEqual({
      jobs: [{ id: 1 }],
      manifest: null,
      warning: "legacy-array",
    });

    const manifest = createJobManifest([{ id: 2 }], {
      createdAt: "2026-06-05T00:00:00.000Z",
    });
    expect(unwrapJobManifest(manifest)).toEqual({
      jobs: [{ id: 2 }],
      manifest,
      warning: null,
    });
  });
});
