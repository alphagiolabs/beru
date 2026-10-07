import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createPathSecurity } from "../main/pathSecurity.js";
import { sanitizeJobMedia, sanitizeBatchJobMedia } from "../main/utils/process-media-validation.js";
import { validateBatchOutputPaths } from "../main/utils/process-output.js";

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

describe.each(["preview", "batch"])("process-media-validation (%s)", (mode) => {
  const sanitize = async (job, security, options) =>
    mode === "preview"
      ? sanitizeJobMedia(job, security, options)
      : (await sanitizeBatchJobMedia([job], security, options))[0];
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
    } catch {}
  });

  it("sets input_root and asset_roots without an output dir", async () => {
    const result = await sanitize(
      {
        input_path: videoFile,
        operations: [{ mode: "image", image_path: imageFile }],
      },
      security,
    );

    expect(result.input_path).toBe(fs.realpathSync.native(videoFile));
    expect(result.input_root).toBe(path.dirname(result.input_path));
    expect(result.asset_roots).toEqual([path.dirname(result.operations[0].image_path)]);
    expect(result.operations[0].image_path).toBe(fs.realpathSync.native(imageFile));
    expect(result.output_path).toBeUndefined();
    expect(result.output_root).toBeUndefined();
  });

  it("rejects unauthorized overlay images", async () => {
    const outsideImage = "C:\\Windows\\System32\\beru-evil-overlay.png";
    await expect(
      sanitize(
        {
          input_path: videoFile,
          operations: [{ mode: "image", image_path: outsideImage }],
        },
        security,
      ),
    ).rejects.toThrow(/Imagen no permitida/i);
  });

  it("derives output_path when outputDirectory is provided", async () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "beru-out-"));
    try {
      const job = await sanitize(
        {
          input_path: videoFile,
          output_path: "out.mp4",
          operations: [{ mode: "image", image_path: imageFile }],
        },
        security,
        { outputDirectory: outDir },
      );
      expect(job.output_root).toBe(outDir);
      expect(job.output_path).toBe(path.join(outDir, "out.mp4"));
      expect(job.asset_roots.length).toBe(1);
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });

  if (mode === "batch") {
    it("rejects output aliases to inputs and duplicate outputs after canonicalization", async () => {
      const input = { input_path: videoFile, operations: [] };
      await expect(
        validateBatchOutputPaths([{ ...input, output_path: videoFile.toUpperCase() }]),
      ).rejects.toThrow(/coincide con una entrada/);
      await expect(
        validateBatchOutputPaths([
          { ...input, output_path: path.join(tmpDir, "out.mp4") },
          { ...input, output_path: path.join(tmpDir, "OUT.mp4") },
        ]),
      ).rejects.toThrow(/comparten la misma ruta/);
    });

    it("rejects an input revoked between batches", async () => {
      const restricted = createPathSecurity({
        getPath: () => path.join(tmpDir, "trusted"),
        getAppPath: () => path.join(tmpDir, "trusted"),
        isPackaged: false,
      });
      restricted.registerSelectedPath(videoFile, "video");
      const job = { input_path: videoFile, operations: [] };
      expect((await sanitizeBatchJobMedia([job, job], restricted)).length).toBe(2);
      restricted.releaseVideoPaths([videoFile]);
      await expect(sanitizeBatchJobMedia([job], restricted)).rejects.toThrow(
        /Entrada no permitida/,
      );
    });
  }
});
