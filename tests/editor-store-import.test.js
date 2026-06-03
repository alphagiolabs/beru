import { describe, it, expect } from "vitest";

/** Regression: duplicate imports in slice modules must not break the store bundle. */
describe("useEditorStore module graph", () => {
  it("loads without duplicate-binding errors", async () => {
    globalThis.window = { api: undefined };
    const mod = await import("../src/stores/useEditorStore.js");
    expect(mod.default.getState).toBeTypeOf("function");
    expect(mod.default.getState().queue).toEqual([]);
  });
});
