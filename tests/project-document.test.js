import { describe, it, expect } from "vitest";
import {
  PRESET_TYPE,
  PROJECT_TYPE,
  PROJECT_VERSION,
  isProjectOrPreset,
  validateProjectDocument,
} from "../shared/project-document.js";

describe("validateProjectDocument", () => {
  it("accepts a serialized project without queue", () => {
    const result = validateProjectDocument({
      type: PROJECT_TYPE,
      version: PROJECT_VERSION,
      templateRegions: [],
      textStyle: {},
      defaults: {},
      excel: null,
      watermark: { enabled: false },
    });
    expect(result).toEqual({ valid: true });
  });

  it("accepts a preset document", () => {
    expect(
      validateProjectDocument({
        type: PRESET_TYPE,
        version: PROJECT_VERSION,
      }),
    ).toEqual({ valid: true });
  });

  it("rejects missing type", () => {
    const result = validateProjectDocument({ version: PROJECT_VERSION, queue: [] });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/tipo/i);
  });

  it("rejects missing version", () => {
    const result = validateProjectDocument({ type: PROJECT_TYPE });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/version/i);
  });

  it("accepts a legacy queue without item ids", () => {
    const result = validateProjectDocument({
      type: PROJECT_TYPE,
      version: "1.2.0",
      queue: [{ path: "C:\\v\\a.mp4", filename: "a.mp4" }],
    });
    expect(result).toEqual({ valid: true });
  });

  it("rejects a queue item without a path", () => {
    const result = validateProjectDocument({
      type: PROJECT_TYPE,
      version: PROJECT_VERSION,
      queue: [{ filename: "a.mp4" }],
    });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/queue/i);
  });
});

describe("isProjectOrPreset", () => {
  it("accepts both document types", () => {
    expect(isProjectOrPreset({ type: PROJECT_TYPE })).toBe(true);
    expect(isProjectOrPreset({ type: PRESET_TYPE })).toBe(true);
    expect(isProjectOrPreset({ type: "other" })).toBe(false);
  });
});
