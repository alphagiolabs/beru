import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { pickHwEncoderFromEncodersText } from "../main/workerPolicy.js";

describe("Windows platform contract", () => {
  it.each(["dev.mjs", "build-processor.mjs", "fetch-ffmpeg.mjs", "test-python.mjs"])(
    "rejects an unsupported OS before %s starts work",
    (script) => {
      const result = spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `Object.defineProperty(process, "platform", { value: "linux" }); await import("./scripts/${script}");`,
        ],
        { encoding: "utf8", windowsHide: true, timeout: 10000 },
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Beru solo admite Windows.");
    },
  );

  it.each(["linux", "darwin"])("rejects processor execution on %s", (platform) => {
    const result = spawnSync(
      "python",
      [
        "-c",
        `import sys; sys.path.insert(0, 'python'); import processor; sys.platform='${platform}'; processor.main()`,
      ],
      { encoding: "utf8", windowsHide: true, timeout: 10000 },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Beru solo admite Windows.");
  });

  it("ignores encoders that Windows cannot use", () => {
    expect(pickHwEncoderFromEncodersText("h264_vaapi h264_videotoolbox")).toBeNull();
    expect(pickHwEncoderFromEncodersText("h264_vaapi h264_mf h264_qsv")).toBe("h264_qsv");
  });
});
