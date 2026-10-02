import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { PERF_FLAGS } from "../src/utils/perf-flags.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("Frontend performance contracts", () => {
  it("PERF_FLAGS default to the proven-on values", () => {
    expect(PERF_FLAGS).toEqual({
      progressMap: true,
      virtualize: true,
      virtualizeThreshold: 100,
      delogoThrottleFps: 30,
    });
  });

  it("lazy-loads heavy modals (ShortcutsModal, TableEditor, ExcelMappingModal, WatermarkModal)", () => {
    const panels = readFileSync(join(root, "src/components/modal-panels.js"), "utf-8");
    for (const name of ["ShortcutsModal", "TableEditor", "ExcelMappingModal", "WatermarkModal"]) {
      expect(panels, name).toMatch(
        new RegExp(`${name}\\s*=\\s*lazyPanel\\(\\(\\)\\s*=>\\s*import\\(`),
      );
    }
    const app = readFileSync(join(root, "src/App.jsx"), "utf-8");
    expect(app).toContain('from "./components/modal-panels"');
    expect(app).toContain("Suspense");
  });
});
