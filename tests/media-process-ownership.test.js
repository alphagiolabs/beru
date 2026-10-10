import { afterEach, describe, expect, it, vi } from "vitest";

const resolveProcessorSpawnAsync = vi.hoisted(() => vi.fn());
vi.mock("../main/utils/processor-spawn.js", () => ({ resolveProcessorSpawnAsync }));
import { runCapturedProcess } from "../main/utils/run-captured.js";

const electronVersion = Object.getOwnPropertyDescriptor(process.versions, "electron");
afterEach(() => {
  if (electronVersion) Object.defineProperty(process.versions, "electron", electronVersion);
  else delete process.versions.electron;
  vi.resetAllMocks();
});

describe("Electron media process ownership", () => {
  it.each(["ffmpeg.exe", "ffprobe.exe"])(
    "runs %s through the processor while preserving its output and exit code",
    async (command) => {
      Object.defineProperty(process.versions, "electron", { configurable: true, value: "43.7.7" });
      resolveProcessorSpawnAsync.mockResolvedValue({
        command: process.execPath,
        args: [
          "-e",
          "process.stdout.write(process.env.BERU_PARENT_PID); process.stderr.write('decoder failed'); process.exit(7)",
        ],
      });
      const result = await runCapturedProcess(command, ["-i", "clip.mp4"]);
      expect(resolveProcessorSpawnAsync).toHaveBeenCalledWith([
        "--run-media",
        command,
        "-i",
        "clip.mp4",
      ]);
      expect(result).toMatchObject({
        code: 7,
        stdout: String(process.pid),
        stderr: "decoder failed",
      });
    },
  );

  it("reports an unavailable owner instead of spawning unowned media", async () => {
    Object.defineProperty(process.versions, "electron", { configurable: true, value: "43.7.7" });
    resolveProcessorSpawnAsync.mockResolvedValue(null);
    expect(await runCapturedProcess("ffmpeg.exe", [])).toMatchObject({
      code: null,
      error: { message: expect.stringMatching(/motor/) },
    });
  });
});
