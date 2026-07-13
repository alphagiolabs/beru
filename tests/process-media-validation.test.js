import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createPathSecurity } from "../main/pathSecurity.js";
import {
  sanitizeJobMedia,
  prepareJobsForProcessor,
} from "../main/utils/process-media-validation.js";

const fakeApp = {
  getPath: (name) => {
    const map = {
      userData: path.join(os.tmpdir(), "beru-test-userdata"),
      temp: os.tmpdir(),
      home: os.homedir(),
      documents: path.join(os.homedir(), "Documents"),
      downloads: path.join(os.homedir(), "Downloads"),
      desktop: path.join(os.homedir(), "Desktop"),
      videos: path.join(os.homedir(), "Videos"),
      music: path.join(os.homedir(), "Music"),
      pictures: path.join(os.homedir(), "Pictures"),
    };
    return map[name] || os.tmpdir();
  },
  isPackaged: false,
  getAppPath: () => process.cwd(),
};

describe("process-media-validation", () => {
  let security;
  let tmpDir;
  let videoFile;
  let imageFile;

  beforeEach(() => {
    security = createPathSecurity(fakeApp);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "beru-media-"));
    videoFile = path.join(tmpDir, "clip.mp4");
    imageFile = path.join(tmpDir, "logo.png");
    fs.writeFileSync(videoFile, Buffer.from("fake-video"));
    fs.writeFileSync(imageFile, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    security.registerAllowedPath(videoFile);
    security.registerAllowedPath(imageFile);
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("sanitizeJobMedia sets input_root and asset_roots for preview (no output dir)", () => {
    const result = sanitizeJobMedia(
      {
        input_path: videoFile,
        operations: [{ mode: "image", image_path: imageFile }],
      },
      security,
    );

    expect(result.input_path).toBe(fs.realpathSync(videoFile));
    expect(result.input_root).toBe(path.dirname(result.input_path));
    expect(result.asset_roots).toEqual([path.dirname(result.operations[0].image_path)]);
    expect(result.operations[0].image_path).toBe(fs.realpathSync(imageFile));
    expect(result.output_path).toBeUndefined();
    expect(result.output_root).toBeUndefined();
  });

  it("sanitizeJobMedia rejects unauthorized overlay images", () => {
    // Path under a denied system prefix (same pattern as path-security.test.js).
    const outsideImage =
      process.platform === "win32"
        ? "C:\\Windows\\System32\\beru-evil-overlay.png"
        : "/etc/beru-evil-overlay.png";
    expect(() =>
      sanitizeJobMedia(
        {
          input_path: videoFile,
          operations: [{ mode: "image", image_path: outsideImage }],
        },
        security,
      ),
    ).toThrow(/Imagen no permitida/i);
  });

  it("prepareJobsForProcessor still requires output directory and derives output_path", () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "beru-out-"));
    try {
      const [job] = prepareJobsForProcessor(
        [
          {
            input_path: videoFile,
            output_path: "out.mp4",
            operations: [{ mode: "image", image_path: imageFile }],
          },
        ],
        outDir,
        security,
      );
      expect(job.output_root).toBe(outDir);
      expect(job.output_path).toBe(path.join(outDir, "out.mp4"));
      expect(job.asset_roots.length).toBe(1);
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });
});
