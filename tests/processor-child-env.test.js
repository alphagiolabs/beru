import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { isPackaged: false } }));

import { buildProcessorChildEnv } from "../main/utils/processor-spawn.js";

describe("Processor child environment", () => {
  it("defaults OpenBLAS to one thread without mutating the parent environment", () => {
    const parent = { BERU_PYTHON: "python.exe", EXISTING_VALUE: "retained" };
    const child = buildProcessorChildEnv(parent, {
      ffmpegPath: "ffmpeg.exe",
      ffprobePath: "ffprobe.exe",
    });
    expect(child).toMatchObject({
      OPENBLAS_NUM_THREADS: "1",
      PYTHONIOENCODING: "utf-8",
      PYTHONUTF8: "1",
      BERU_PARENT_PID: String(process.pid),
      BERU_FFMPEG: "ffmpeg.exe",
      BERU_FFPROBE: "ffprobe.exe",
      EXISTING_VALUE: "retained",
    });
    expect(parent).toEqual({ BERU_PYTHON: "python.exe", EXISTING_VALUE: "retained" });
  });

  it("preserves an explicit OpenBLAS thread setting", () => {
    expect(buildProcessorChildEnv({ OPENBLAS_NUM_THREADS: "3" }).OPENBLAS_NUM_THREADS).toBe("3");
  });
});
