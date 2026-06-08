import { describe, it, expect, beforeEach } from "vitest";
import { spawnSync } from "child_process";
import path from "path";
import useEditorStore from "../src/stores/useEditorStore.js";
import { buildBatchTextOperationsForPreview } from "../src/utils/preview-frame-job.js";

const PY =
  process.env.BERU_PYTHON ||
  (process.platform === "win32" ? "py" : "python3");
const PY_ARGS = process.platform === "win32" ? ["-3"] : [];
const PROCESSOR = path.join(process.cwd(), "python", "processor.py");

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
    expect(job.operations.some((op) => op.mode === "text" && op.text === "Hola FFmpeg")).toBe(
      true,
    );
  });

  it("buildBatchTextOperationsForPreview mirrors materialize logic for one item", () => {
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
