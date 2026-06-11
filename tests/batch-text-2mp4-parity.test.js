/**
 * Integration: 2.mp4 + Plantilla.xlsx batch text export matches CSS preview contract.
 * Verifies the FFmpeg filter graph uses a full-region drawbox (not a glyph box)
 * and that preview-frame rendering succeeds with real assets.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { spawnSync } from "child_process";
import path from "path";
import XLSX from "xlsx";
import useEditorStore from "../src/stores/useEditorStore.js";
import { createQueueItem } from "../src/utils/types.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const VIDEO_PATH = path.join(ROOT, "2.mp4");
const EXCEL_PATH = path.join(ROOT, "Plantilla.xlsx");
const PY = process.platform === "win32" ? "python" : "python3";
const PY_CODE_PREFIX =
  "import sys; sys.stdout.reconfigure(encoding='utf-8'); sys.path.insert(0, 'python'); ";

const hasPython = (() => {
  try {
    return spawnSync(PY, ["--version"], { encoding: "utf8" }).status === 0;
  } catch {
    return false;
  }
})();

const hasAssets = (() => {
  try {
    return (
      spawnSync(
        PY,
        [
          "-c",
          `import os; raise SystemExit(0 if os.path.exists(${JSON.stringify(VIDEO_PATH)}) and os.path.exists(${JSON.stringify(EXCEL_PATH)}) else 1)`,
        ],
        {
          encoding: "utf8",
        },
      ).status === 0
    );
  } catch {
    return false;
  }
})();

const describeIfReady = hasPython && hasAssets ? describe : describe.skip;

function probeVideo(filePath) {
  const r = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-of",
      "json",
      filePath,
    ],
    { encoding: "utf8" },
  );
  if (r.status !== 0) return null;
  const stream = JSON.parse(r.stdout).streams?.[0];
  if (!stream?.width || !stream?.height) return null;
  return { width: stream.width, height: stream.height };
}

describeIfReady("batch text parity — 2.mp4 + Plantilla.xlsx", () => {
  const dims = probeVideo(VIDEO_PATH);

  beforeEach(() => {
    useEditorStore.setState({
      queue: [],
      templateRegions: [],
      excelRows: [],
      excelMapping: { idColumn: null, columns: {} },
      sidebarMode: "batch",
      textFontSize: 32,
      textFontColor: "white",
      fontFamily: "Arial",
      bgEnabled: true,
      bgColor: "black",
      bgOpacity: 0.65,
      boxBorderWidth: 4,
      safeMargin: 4,
    });
  });

  it("builds export job with Excel text and full-region drawbox filter", () => {
    expect(dims).not.toBeNull();

    const wb = XLSX.readFile(EXCEL_PATH);
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    const region = { x: 0.1, y: 0.78, w: 0.8, h: 0.12 };

    useEditorStore.setState({
      queue: [
        createQueueItem({
          path: VIDEO_PATH,
          filename: "2.mp4",
          width: dims.width,
          height: dims.height,
          sourceWidth: dims.width,
          sourceHeight: dims.height,
        }),
      ],
      templateRegions: [{ id: "r1", label: "TEXT_1", region, style: {} }],
      excelRows: rows,
      excelMapping: { idColumn: "id", columns: { r1: "TEXT_1" } },
    });

    useEditorStore.getState()._buildExcelRowIndex();
    useEditorStore.getState()._reapplyExcel();
    useEditorStore.getState().materializeBatchTextOps();

    const job = useEditorStore.getState().buildPreviewFrameJob(0, 1);
    expect(job).not.toBeNull();
    expect(job.operations).toHaveLength(1);
    expect(job.operations[0].text).toBe("OT  89898990");
    expect(job.operations[0].bg_enabled).toBe(true);

    const px = {
      x: Math.round(region.x * dims.width),
      y: Math.round(region.y * dims.height),
      w: Math.round(region.w * dims.width),
      h: Math.round(region.h * dims.height),
    };

    const code = `
import json
import processor
processor.get_system_fonts()
processor._init_ffmpeg_globals()
job = json.loads(${JSON.stringify(JSON.stringify(job))})
graph, last, imgs = processor.build_filter_complex(job["operations"], job["width"], job["height"])
print(json.dumps({"graph": graph, "ok": graph is not None}))
`;
    const r = spawnSync(PY, ["-c", PY_CODE_PREFIX + code], { encoding: "utf8", timeout: 20000 });
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout.trim().split("\n").pop());
    expect(parsed.ok).toBe(true);
    expect(parsed.graph).toContain(`drawbox=x=${px.x}:y=${px.y}:w=${px.w}:h=${px.h}`);
    expect(parsed.graph).toContain("text='OT  89898990'");
    expect(parsed.graph).not.toContain("box=1");
  });

  it("renders a preview frame from 2.mp4 with Plantilla batch text", () => {
    const wb = XLSX.readFile(EXCEL_PATH);
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    const region = { x: 0.1, y: 0.78, w: 0.8, h: 0.12 };

    useEditorStore.setState({
      queue: [
        createQueueItem({
          path: VIDEO_PATH,
          filename: "2.mp4",
          width: dims.width,
          height: dims.height,
          sourceWidth: dims.width,
          sourceHeight: dims.height,
        }),
      ],
      templateRegions: [{ id: "r1", label: "TEXT_1", region, style: {} }],
      excelRows: rows,
      excelMapping: { idColumn: "id", columns: { r1: "TEXT_1" } },
    });

    useEditorStore.getState()._buildExcelRowIndex();
    useEditorStore.getState()._reapplyExcel();

    const job = useEditorStore.getState().buildPreviewFrameJob(0, 2);
    const code = `
import json
import processor
processor.get_system_fonts()
processor._init_ffmpeg_globals()
job = json.loads(${JSON.stringify(JSON.stringify(job))})
result = processor.render_preview_frame(job)
print(json.dumps({"ok": result.get("ok"), "has_image": bool(result.get("data_url"))}))
`;
    const r = spawnSync(PY, ["-c", PY_CODE_PREFIX + code], {
      encoding: "utf8",
      timeout: 60000,
    });
    if (r.status !== 0) {
      console.error("STDOUT:", r.stdout);
      console.error("STDERR:", r.stderr);
    }
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout.trim().split("\n").pop());
    expect(parsed.ok).toBe(true);
    expect(parsed.has_image).toBe(true);
  });
});
