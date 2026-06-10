import { describe, expect, it } from "vitest";
import {
  createJobManifest,
  isJobManifest,
  JOB_MANIFEST_TYPE,
  JOB_MANIFEST_VERSION,
} from "../src/utils/job-manifest.js";
import { unwrapJobManifest } from "../main/utils/jobManifest.js";

describe("job manifest", () => {
  describe("createJobManifest", () => {
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

    it("uses balanced as default profile when not specified", () => {
      const manifest = createJobManifest([{ id: 1 }]);
      expect(manifest.profile).toBe("balanced");
    });

    it("generates createdAt timestamp when not provided", () => {
      const manifest = createJobManifest([{ id: 1 }]);
      expect(manifest.createdAt).toBeDefined();
      expect(typeof manifest.createdAt).toBe("string");
    });

    it("handles empty jobs array", () => {
      const manifest = createJobManifest([]);
      expect(manifest.jobs).toEqual([]);
      expect(manifest.profile).toBe("balanced");
    });
  });

  describe("isJobManifest", () => {
    it("rejects non-manifest payloads", () => {
      expect(isJobManifest([{ id: 1 }])).toBe(false);
      expect(isJobManifest({ type: JOB_MANIFEST_TYPE, version: 999, jobs: [] })).toBe(false);
    });

    it("rejects null and undefined", () => {
      expect(isJobManifest(null)).toBe(false);
      expect(isJobManifest(undefined)).toBe(false);
    });

    it("rejects objects without jobs array", () => {
      expect(
        isJobManifest({
          type: JOB_MANIFEST_TYPE,
          version: JOB_MANIFEST_VERSION,
        }),
      ).toBe(false);
    });
  });

  describe("unwrapJobManifest", () => {
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
});
