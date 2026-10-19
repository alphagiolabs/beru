import { describe, it, expect } from "vitest";
import contract from "../resources/job-manifest-fixtures.json" with { type: "json" };
import {
  normalizeManifest,
  JOB_MANIFEST_TYPE,
  JOB_MANIFEST_VERSION,
} from "../shared/job-manifest.js";

const resolveField = (job, path) =>
  path.split(".").reduce((value, key) => (value == null ? undefined : value[key]), job);

describe("job manifest contract (JSON)", () => {
  it("is versioned with one representative job per kind", () => {
    expect(contract.version).toBe(1);
    expect(contract.jobs.map((job) => job.kind)).toEqual(["video", "composition", "stabilization"]);
    expect(contract.expected).toHaveLength(contract.jobs.length);
  });
});

describe("job manifest contract (envelope)", () => {
  it("pins the envelope literals", () => {
    expect(JOB_MANIFEST_TYPE).toBe(contract.envelope.type);
    expect(JOB_MANIFEST_VERSION).toBe(contract.envelope.version);
  });
});

describe("job manifest contract (JS normalization)", () => {
  it("normalizes every fixture job to the pinned fields", () => {
    const manifest = normalizeManifest({
      type: contract.envelope.type,
      version: contract.envelope.version,
      jobs: contract.jobs,
    });
    expect(manifest.jobs).toHaveLength(contract.expected.length);

    manifest.jobs.forEach((job, i) => {
      const expected = contract.expected[i];
      for (const [path, value] of Object.entries(expected.fields)) {
        expect(resolveField(job, path), `${expected.label}: ${path}`).toEqual(value);
      }
      for (const path of expected.absent) {
        expect(resolveField(job, path), `${expected.label}: ${path}`).toBeUndefined();
      }
    });
  });
});
