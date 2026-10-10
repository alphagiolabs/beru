import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { isPackaged: false } }));

import { buildProcessorChildEnv } from "../main/utils/processor-spawn.js";

describe("Processor child environment", () => {
  it("defaults OpenBLAS to one thread without mutating the parent environment", () => {
    const parent = { BERU_PYTHON: "python.exe", EXISTING_VALUE: "retained" };
    const child = buildProcessorChildEnv(parent);
    expect(child.OPENBLAS_NUM_THREADS).toBe("1");
    expect(child.EXISTING_VALUE).toBe("retained");
    expect(parent).toEqual({ BERU_PYTHON: "python.exe", EXISTING_VALUE: "retained" });
  });

  it("preserves an explicit OpenBLAS thread setting", () => {
    expect(buildProcessorChildEnv({ OPENBLAS_NUM_THREADS: "3" }).OPENBLAS_NUM_THREADS).toBe("3");
  });
});
