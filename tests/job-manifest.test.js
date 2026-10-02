import { describe, expect, it } from "vitest";
import {
  JOB_MANIFEST_TYPE,
  JOB_MANIFEST_VERSION,
  normalizeJob,
  normalizeManifest,
} from "../shared/job-manifest.js";
import { createJobManifest } from "../src/utils/job-manifest.js";
import { createProcessorManifest, unwrapJobManifest } from "../main/utils/jobManifest.js";
import { MINIMAL_JOB, MINIMAL_JOB_NORMALIZED, RAW_JOB } from "./fixtures/job-manifest.js";

describe("normalizeJob", () => {
  it("fills every field default on a minimal job", () => {
    expect(normalizeJob(MINIMAL_JOB)).toEqual(MINIMAL_JOB_NORMALIZED);
  });

  it("keeps a fully populated job unchanged (idempotent)", () => {
    expect(normalizeJob(RAW_JOB)).toEqual(RAW_JOB);
    expect(normalizeJob(normalizeJob(RAW_JOB))).toEqual(RAW_JOB);
  });

  it("repairs non-integer or missing ids to the job position", () => {
    expect(normalizeJob({ id: "x" }, 4).id).toBe(4);
    expect(normalizeJob({}, 2).id).toBe(2);
    expect(normalizeJob({ id: 7 }, 4).id).toBe(7);
  });

  it("resolves the width/height alias pair into canonical dimensions", () => {
    const job = normalizeJob({ width: 1280, height: 720 });
    expect([job.width, job.height, job.source_width, job.source_height]).toEqual([
      1280, 720, 1280, 720,
    ]);
    const fromSource = normalizeJob({ source_width: 640, source_height: 360 });
    expect([fromSource.width, fromSource.source_width]).toEqual([640, 640]);
  });

  it("marks video_info_probed only when the job carries complete probe metadata", () => {
    const complete = {
      source_width: 100,
      source_height: 50,
      video_duration: 3,
      pix_fmt: "yuv420p",
    };
    expect(normalizeJob(complete).video_info_probed).toBe(true);
    expect(normalizeJob({ ...complete, pix_fmt: undefined }).video_info_probed).toBe(false);
    expect(normalizeJob({ ...complete, video_duration: 0 }).video_info_probed).toBe(false);
    expect(normalizeJob({ video_info_probed: true }).video_info_probed).toBe(true);
  });

  it("keeps non-numeric trim values so the processor validation still fires", () => {
    const job = normalizeJob({ trim_start: "abc", trim_end: "later" });
    expect(job.trim_start).toBe("abc");
    expect(job.trim_end).toBe("later");
  });

  it("normalizes watermark and operations shapes", () => {
    const job = normalizeJob({ operations: "nope", watermark: "nope" });
    expect(job.operations).toEqual([]);
    expect(job.watermark).toBeNull();
  });

  it("passes non-object jobs through untouched", () => {
    expect(normalizeJob(null)).toBeNull();
    expect(normalizeJob("x")).toBe("x");
    expect(normalizeJob([1, 2])).toEqual([1, 2]);
  });
});

describe("normalizeManifest", () => {
  it("validates the envelope and normalizes every job", () => {
    const { manifest, jobs } = normalizeManifest({
      type: JOB_MANIFEST_TYPE,
      version: JOB_MANIFEST_VERSION,
      createdAt: "2026-06-05T00:00:00.000Z",
      jobs: [MINIMAL_JOB],
    });
    expect(jobs).toEqual([MINIMAL_JOB_NORMALIZED]);
    expect(manifest).toMatchObject({
      type: JOB_MANIFEST_TYPE,
      createdAt: "2026-06-05T00:00:00.000Z",
    });
  });

  it("accepts legacy bare arrays without an envelope", () => {
    expect(normalizeManifest([MINIMAL_JOB])).toEqual({
      manifest: null,
      jobs: [MINIMAL_JOB_NORMALIZED],
    });
  });

  it("rejects invalid payloads with the surfaced error messages", () => {
    expect(() => normalizeManifest(null)).toThrow("Payload de procesamiento inválido");
    expect(() =>
      normalizeManifest({ type: "wrong", version: JOB_MANIFEST_VERSION, jobs: [] }),
    ).toThrow("Tipo de manifiesto de procesamiento inválido");
    expect(() => normalizeManifest({ type: JOB_MANIFEST_TYPE, version: 999, jobs: [] })).toThrow(
      "Versión de manifiesto no soportada: 999",
    );
    expect(() =>
      normalizeManifest({ type: JOB_MANIFEST_TYPE, version: JOB_MANIFEST_VERSION }),
    ).toThrow("El manifiesto no contiene jobs válidos");
  });
});

describe("createJobManifest", () => {
  it("wraps normalized renderer jobs in a versioned manifest", () => {
    const manifest = createJobManifest([{ id: 7, encode_profile: "quality" }], {
      createdAt: "2026-06-05T00:00:00.000Z",
    });

    expect(manifest).toEqual({
      type: JOB_MANIFEST_TYPE,
      version: JOB_MANIFEST_VERSION,
      createdAt: "2026-06-05T00:00:00.000Z",
      jobs: [normalizeJob({ id: 7, encode_profile: "quality" }, 0)],
    });
    expect(unwrapJobManifest(manifest).error).toBeUndefined();
  });

  it("does not emit a manifest-level profile (resolved per-job by Python)", () => {
    const manifest = createJobManifest([{ id: 1, encode_profile: "quality" }]);
    expect(manifest).not.toHaveProperty("profile");
  });

  it("generates createdAt timestamp when not provided", () => {
    const manifest = createJobManifest([{ id: 1 }]);
    expect(manifest.createdAt).toBeDefined();
    expect(typeof manifest.createdAt).toBe("string");
  });

  it("handles empty jobs array", () => {
    const manifest = createJobManifest([]);
    expect(manifest.jobs).toEqual([]);
  });
});

describe("unwrapJobManifest", () => {
  it("main unwraps new manifests and keeps legacy arrays compatible", () => {
    expect(unwrapJobManifest([MINIMAL_JOB])).toEqual({
      jobs: [MINIMAL_JOB_NORMALIZED],
      manifest: null,
    });

    const manifest = createJobManifest([{ id: 2 }], {
      createdAt: "2026-06-05T00:00:00.000Z",
    });
    expect(unwrapJobManifest(manifest)).toEqual({
      jobs: manifest.jobs,
      manifest,
    });
  });

  it("returns error for null or undefined payload", () => {
    expect(unwrapJobManifest(null)).toEqual({
      jobs: [],
      manifest: null,
      error: "Payload de procesamiento inválido",
    });
    expect(unwrapJobManifest(undefined)).toEqual({
      jobs: [],
      manifest: null,
      error: "Payload de procesamiento inválido",
    });
  });

  it("returns error for invalid manifest type", () => {
    expect(
      unwrapJobManifest({
        type: "wrong-type",
        version: JOB_MANIFEST_VERSION,
        jobs: [],
      }),
    ).toEqual({
      jobs: [],
      manifest: null,
      error: "Tipo de manifiesto de procesamiento inválido",
    });
  });

  it("returns error for unsupported manifest version", () => {
    expect(
      unwrapJobManifest({
        type: JOB_MANIFEST_TYPE,
        version: 999,
        jobs: [],
      }),
    ).toEqual({
      jobs: [],
      manifest: null,
      error: "Versión de manifiesto no soportada: 999",
    });
  });

  it("returns error when manifest has no jobs array", () => {
    expect(
      unwrapJobManifest({
        type: JOB_MANIFEST_TYPE,
        version: JOB_MANIFEST_VERSION,
      }),
    ).toEqual({
      jobs: [],
      manifest: null,
      error: "El manifiesto no contiene jobs válidos",
    });
  });
});

describe("createProcessorManifest", () => {
  it("reuses the incoming createdAt and normalizes enriched jobs", () => {
    const manifest = createProcessorManifest({ createdAt: "2026-06-05T00:00:00.000Z" }, [
      { ...MINIMAL_JOB, id: 1 },
    ]);
    expect(manifest).toEqual({
      type: JOB_MANIFEST_TYPE,
      version: JOB_MANIFEST_VERSION,
      createdAt: "2026-06-05T00:00:00.000Z",
      jobs: [{ ...MINIMAL_JOB_NORMALIZED, id: 1 }],
    });
  });
});
