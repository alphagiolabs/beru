import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { spawn, spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import readline from "readline";
import useEditorStore from "../src/stores/useEditorStore.js";
import { buildBatchTextOperationsForPreview } from "../src/utils/preview-frame-job.js";
import { disposePreviewFrameWorker, renderPreviewFrame } from "../main/utils/preview-frame.js";
import { createPathSecurity } from "../main/pathSecurity.js";
import { sanitizeJobMedia } from "../main/utils/process-media-validation.js";

vi.mock("electron", () => ({ app: { isPackaged: false } }));

const PY = process.env.BERU_PYTHON || (process.platform === "win32" ? "py" : "python3");
const PY_ARGS = process.platform === "win32" ? ["-3"] : [];
const PROCESSOR = path.join(process.cwd(), "python", "processor.py");
const FFMPEG_BIN = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";

const hasFfmpeg = (() => {
  try {
    return spawnSync(FFMPEG_BIN, ["-version"], { encoding: "utf8" }).status === 0;
  } catch {
    return false;
  }
})();

const describeIfFfmpeg = hasFfmpeg ? describe : describe.skip;

function createJsonLineReader(stream) {
  const lines = [];
  const waiters = [];
  const reader = readline.createInterface({ input: stream });
  reader.on("line", (line) => {
    const value = JSON.parse(line);
    const resolve = waiters.shift();
    if (resolve) resolve(value);
    else lines.push(value);
  });
  return {
    next() {
      if (lines.length > 0) return Promise.resolve(lines.shift());
      return new Promise((resolve) => waiters.push(resolve));
    },
    close() {
      reader.close();
    },
  };
}

describe("preview frame job", () => {
  beforeEach(() => {
    useEditorStore.setState({
      queue: [],
      templateRegions: [],
      selectedIdx: -1,
      excelMapping: { idColumn: null, columns: {} },
      excelRows: [],
      watermark: { enabled: false },
    });
  });

  it("buildPreviewFrameJob includes timestamp and batch text without mutating queue", () => {
    useEditorStore.setState({
      selectedIdx: 0,
      queue: [
        {
          path: "C:\\videos\\video_0.mp4",
          filename: "video_0.mp4",
          width: 1920,
          height: 1080,
          duration: 10,
          operations: [],
        },
      ],
      templateRegions: [
        {
          id: "r1",
          label: "TEXT_1",
          region: { x: 0.1, y: 0.1, w: 0.3, h: 0.1 },
          style: {},
        },
      ],
      excelRows: [{ id: "video_0", TEXT_1: "Hola FFmpeg" }],
      excelMapping: { idColumn: "id", columns: { r1: "TEXT_1" } },
    });

    const beforeOps = useEditorStore.getState().queue[0].operations.length;
    const job = useEditorStore.getState().buildPreviewFrameJob(0, 1.5);
    const afterOps = useEditorStore.getState().queue[0].operations.length;

    expect(afterOps).toBe(beforeOps);
    expect(job.timestamp).toBe(1.5);
    expect(job.input_path).toContain("video_0.mp4");
    expect(job.operations.some((op) => op.mode === "text" && op.text === "Hola FFmpeg")).toBe(true);
  });

  it("buildBatchTextOperationsForPreview uses excel text when available", () => {
    useEditorStore.setState({
      queue: [
        {
          path: "C:\\videos\\clip.mp4",
          filename: "clip.mp4",
          operations: [],
          width: 1280,
          height: 720,
        },
      ],
      templateRegions: [
        {
          id: "r1",
          label: "TEXT_1",
          region: { x: 0.2, y: 0.2, w: 0.2, h: 0.1 },
          style: { fontSize: 40 },
        },
      ],
      excelRows: [{ id: "clip", TEXT_1: "Batch" }],
      excelMapping: { idColumn: "id", columns: { r1: "TEXT_1" } },
    });

    const ops = buildBatchTextOperationsForPreview(useEditorStore.getState(), 0);
    expect(ops).toHaveLength(1);
    expect(ops[0].text).toBe("Batch");
    expect(ops[0].fontSize).toBe(40);
  });

  it("buildBatchTextOperationsForPreview uses CSS sample text when excel cell is empty", () => {
    useEditorStore.setState({
      queue: [
        {
          path: "C:\\videos\\clip.mp4",
          filename: "clip.mp4",
          operations: [],
          width: 1280,
          height: 720,
        },
      ],
      templateRegions: [
        {
          id: "r1",
          label: "TEXT_1",
          region: { x: 0.2, y: 0.2, w: 0.2, h: 0.1 },
          style: { fontSize: 36 },
        },
      ],
      excelRows: [],
      excelMapping: { idColumn: null, columns: {} },
    });

    // CSS live preview falls back to the region label; FFmpeg must match so the
    // ScanEye control is not a no-op empty frame when Excel is not linked yet.
    const cssText = useEditorStore.getState().getBatchPreviewText(0, "r1");
    expect(cssText).toBe("TEXT_1");

    const ops = buildBatchTextOperationsForPreview(useEditorStore.getState(), 0);
    expect(ops).toHaveLength(1);
    expect(ops[0].text).toBe("TEXT_1");
    expect(ops[0].fontSize).toBe(36);
  });
});

describe("preview media path parity with batch asset_roots", () => {
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

  let security;
  let tmpDir;
  let videoFile;
  let imageFile;

  beforeEach(() => {
    security = createPathSecurity(fakeApp);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "beru-preview-media-"));
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

  it("rejects unauthorized overlay images outside trusted roots", () => {
    const outsideImage =
      process.platform === "win32"
        ? "C:\\Windows\\System32\\beru-evil-preview.png"
        : "/etc/beru-evil-preview.png";
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

  it("accepts registered overlay images and sets non-empty asset_roots", () => {
    const result = sanitizeJobMedia(
      {
        input_path: videoFile,
        operations: [{ mode: "image", image_path: imageFile }],
      },
      security,
    );
    expect(result.asset_roots.length).toBeGreaterThan(0);
    expect(result.operations[0].image_path).toBe(fs.realpathSync(imageFile));
  });
});

describe("processor render_preview_frame", () => {
  it("returns ok=false for missing input", () => {
    const code = `
import json
import sys
sys.path.insert(0, "python")
import processor
processor.FFMPEG = processor.find_ffmpeg()
processor.FFPROBE = processor.find_ffprobe(processor.FFMPEG)
print(json.dumps(processor.render_preview_frame({"input_path": "__missing__.mp4"})))
`;
    const r = spawnSync(PY, [...PY_ARGS, "-c", code], {
      encoding: "utf8",
      cwd: process.cwd(),
    });
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toMatch(/not found/i);
  });
});

// The two worker tests below need the Python preview worker to actually start,
// which requires ffmpeg/ffprobe on PATH. preview_frame_worker_main() bails with
// {type:"ready", ok:false, error:"ffmpeg not found"} otherwise, so we skip the
// whole block when ffmpeg is missing. The CI workflow installs ffmpeg via
// apt-get so these run there; developer machines without ffmpeg will skip.
describeIfFfmpeg("preview frame worker (requires ffmpeg)", () => {
  it("keeps the preview worker alive across requests and malformed input", async () => {
    const proc = spawn(PY, [...PY_ARGS, PROCESSOR, "--preview-frame-worker"], {
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    const output = createJsonLineReader(proc.stdout);

    try {
      await expect(output.next()).resolves.toMatchObject({ type: "ready", ok: true });

      proc.stdin.write(
        `${JSON.stringify({ id: 1, payload: { input_path: "__missing_a__.mp4" } })}\n`,
      );
      await expect(output.next()).resolves.toMatchObject({ id: 1, ok: false });

      proc.stdin.write("not-json\n");
      await expect(output.next()).resolves.toMatchObject({ id: null, ok: false });

      proc.stdin.write(
        `${JSON.stringify({ id: 2, payload: { input_path: "__missing_b__.mp4" } })}\n`,
      );
      await expect(output.next()).resolves.toMatchObject({ id: 2, ok: false });
    } finally {
      output.close();
      proc.kill();
    }
  });

  it("routes concurrent requests through the persistent worker client", async () => {
    try {
      const [first, second] = await Promise.all([
        renderPreviewFrame({ input_path: "__missing_client_a__.mp4" }),
        renderPreviewFrame({ input_path: "__missing_client_b__.mp4" }),
      ]);

      expect(first).toMatchObject({ ok: false });
      expect(first.error).toMatch(/missing_client_a/i);
      expect(second).toMatchObject({ ok: false });
      expect(second.error).toMatch(/missing_client_b/i);
    } finally {
      disposePreviewFrameWorker();
    }
  });
});
