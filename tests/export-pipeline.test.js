import { describe, it, expect, beforeEach, vi } from "vitest";
import { filterOperationsForExport } from "../src/utils/batch-process.js";

const mockApi = {
  startProcessing: vi.fn(async () => ({ success: true })),
  getVideoInfoBatch: vi.fn(async () => []),
};
globalThis.window = { api: mockApi };

const { default: useEditorStore } = await import("../src/stores/useEditorStore.js");

function queueItem(i, overrides = {}) {
  return {
    path: `C:\\videos\\video_${i}.mp4`,
    src: `beru://local/C%3A%5Cvideos%5Cvideo_${i}.mp4`,
    filename: `video_${i}.mp4`,
    width: 1920,
    height: 1080,
    sourceWidth: 1920,
    sourceHeight: 1080,
    duration: 60,
    videoCodec: "h264",
    pixFmt: "yuv420p",
    frameRate: 30,
    audioCodec: "aac",
    operations: [],
    status: "idle",
    progress: 0,
    eta: null,
    speed: null,
    error: null,
    customOutputName: "",
    thumbnail: null,
    ...overrides,
  };
}

const BASE_STATE = {
  queue: [],
  selectedIdx: -1,
  templateRegions: [],
  excelRows: [],
  excelMapping: { idColumn: null, columns: {} },
  excelMatchStatus: {},
  outputDir: "C:\\output",
  exportFormat: "mp4",
  isProcessing: false,
  progressTotal: 0,
  progressDone: 0,
  logLines: [],
  imageDataCache: {},
  undoStack: [],
  redoStack: [],
  batchSummary: null,
  // Text style defaults
  textInput: "Sample Text",
  textFontSize: 32,
  textFontColor: "white",
  fontFamily: "Arial",
  fontWeight: 400,
  letterSpacing: 0,
  textAlign: "left",
  textOpacity: 1,
  bold: false,
  italic: false,
  bgEnabled: true,
  bgColor: "black",
  bgOpacity: 0.65,
  boxBorderWidth: 4,
  borderWidth: 0,
  borderColor: "black",
  textShadowEnabled: false,
  textShadowColor: "black",
  textShadowOffsetX: 2,
  textShadowOffsetY: 2,
  // Delogo defaults
  blurStrength: 20,
  delogoMethod: "temporal",
  delogoFillColor: "black",
  delogoFillOpacity: 1,
  temporalRadius: 3,
  mosaicSize: 12,
  mirrorSide: "right",
  edgeFeather: 6,
};

describe("Export pipeline — Eliminar Logo + Texto en Lote", () => {
  beforeEach(() => {
    mockApi.startProcessing.mockClear();
    mockApi.getVideoInfoBatch.mockClear();
    mockApi.startProcessing.mockResolvedValue({ success: true });
    mockApi.getVideoInfoBatch.mockResolvedValue([]);
    useEditorStore.setState(BASE_STATE);
  });

  // ═══════════════════════════════════════════════════════════════════
  // ELIMINAR LOGO — delogo operation export pipeline
  // ═══════════════════════════════════════════════════════════════════

  it("builds valid delogo job for temporal method", () => {
    const region = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };
    useEditorStore.setState({
      queue: [
        queueItem(0, {
          operations: [
            {
              id: "delogo-1",
              mode: "delogo",
              region,
              delogoMethod: "temporal",
              temporalRadius: 5,
              edgeFeather: 8,
            },
          ],
        }),
      ],
    });

    const job = useEditorStore.getState()._buildJobFor(useEditorStore.getState().queue[0], 0);

    expect(job).not.toBeNull();
    expect(job.operations).toHaveLength(1);
    // Region should be denormalized to pixels
    expect(job.operations[0].region.x).toBe(192); // 0.1 * 1920
    expect(job.operations[0].region.y).toBe(216); // 0.2 * 1080
    expect(job.operations[0].region.w).toBe(576); // 0.3 * 1920
    expect(job.operations[0].region.h).toBe(108); // 0.1 * 1080
    // Snake_case keys for Python
    expect(job.operations[0].delogo_method).toBe("temporal");
    expect(job.operations[0].temporal_radius).toBe(5);
    expect(job.operations[0].edge_feather).toBe(8);
  });

  it("builds valid delogo job for mirror method", () => {
    const region = { x: 0.5, y: 0.3, w: 0.15, h: 0.1 };
    useEditorStore.setState({
      queue: [
        queueItem(0, {
          operations: [
            {
              id: "delogo-2",
              mode: "delogo",
              region,
              delogoMethod: "mirror",
              mirrorSide: "left",
            },
          ],
        }),
      ],
    });

    const job = useEditorStore.getState()._buildJobFor(useEditorStore.getState().queue[0], 0);
    expect(job.operations[0].delogo_method).toBe("mirror");
    expect(job.operations[0].mirror_side).toBe("left");
  });

  it("builds valid delogo job for inpaint method", () => {
    const region = { x: 0.05, y: 0.05, w: 0.1, h: 0.08 };
    useEditorStore.setState({
      queue: [
        queueItem(0, {
          operations: [
            {
              id: "delogo-3",
              mode: "delogo",
              region,
              delogoMethod: "inpaint",
            },
          ],
        }),
      ],
    });

    const job = useEditorStore.getState()._buildJobFor(useEditorStore.getState().queue[0], 0);
    expect(job.operations[0].delogo_method).toBe("inpaint");
  });

  it("sanitizeOperation clamps delogo params before export", () => {
    const region = { x: 0.1, y: 0.1, w: 0.2, h: 0.1 };
    useEditorStore.setState({
      queue: [
        queueItem(0, {
          operations: [
            {
              id: "delogo-4",
              mode: "delogo",
              region,
              delogoMethod: "invalid-method", // should fallback to "temporal"
              temporalRadius: 999, // should clamp to 15
              mosaicSize: -5, // should clamp to 4
              edgeFeather: 100, // should clamp to 40
              blurStrength: 0, // should clamp to 1
            },
          ],
        }),
      ],
    });

    const job = useEditorStore.getState()._buildJobFor(useEditorStore.getState().queue[0], 0);
    expect(job.operations[0].delogo_method).toBe("temporal");
    expect(job.operations[0].temporal_radius).toBe(15);
    expect(job.operations[0].mosaic_size).toBe(4);
    expect(job.operations[0].edge_feather).toBe(40);
    expect(job.operations[0].blur_strength).toBe(1);
  });

  it("mixes delogo + blur + text operations in a single job", () => {
    useEditorStore.setState({
      queue: [
        queueItem(0, {
          operations: [
            {
              id: "op-1",
              mode: "blur",
              region: { x: 0.1, y: 0.1, w: 0.2, h: 0.1 },
              blurStrength: 30,
            },
            {
              id: "op-2",
              mode: "delogo",
              region: { x: 0.5, y: 0.0, w: 0.2, h: 0.05 },
              delogoMethod: "inpaint",
            },
            {
              id: "op-3",
              mode: "text",
              region: { x: 0.1, y: 0.8, w: 0.5, h: 0.1 },
              text: "Hola",
              fontSize: 48,
              fontColor: "#ff0000",
              fontWeight: 700,
              letterSpacing: 2,
              textAlign: "center",
              textOpacity: 0.8,
              bold: true,
              bgEnabled: true,
              bgColor: "white",
              bgOpacity: 0.5,
              boxBorderWidth: 6,
              textShadowEnabled: true,
              textShadowColor: "#111111",
              textShadowOffsetX: 3,
              textShadowOffsetY: 4,
            },
          ],
        }),
      ],
    });

    const job = useEditorStore.getState()._buildJobFor(useEditorStore.getState().queue[0], 0);
    expect(job.operations).toHaveLength(3);
    expect(job.operations[0].mode).toBe("blur");
    expect(job.operations[0].blur_strength).toBe(30);
    expect(job.operations[1].mode).toBe("delogo");
    expect(job.operations[1].delogo_method).toBe("inpaint");
    expect(job.operations[2].mode).toBe("text");
    expect(job.operations[2].text).toBe("Hola");
    expect(job.operations[2].font_size).toBe(48);
    expect(job.operations[2].font_color).toBe("#ff0000");
    expect(job.operations[2].font_weight).toBe(700);
    expect(job.operations[2].letter_spacing).toBe(2);
    expect(job.operations[2].text_align).toBe("center");
    expect(job.operations[2].text_opacity).toBe(0.8);
    expect(job.operations[2].bold).toBe(true);
    expect(job.operations[2].bg_enabled).toBe(true);
    expect(job.operations[2].bg_color).toBe("white");
    expect(job.operations[2].bg_opacity).toBe(0.5);
    expect(job.operations[2].box_border_width).toBe(6);
    expect(job.operations[2].text_shadow_enabled).toBe(true);
    expect(job.operations[2].text_shadow_color).toBe("#111111");
    expect(job.operations[2].text_shadow_offset_x).toBe(3);
    expect(job.operations[2].text_shadow_offset_y).toBe(4);
  });

  // ═══════════════════════════════════════════════════════════════════
  // TEXTO EN LOTE — batch text operations export pipeline
  // ═══════════════════════════════════════════════════════════════════

  it("materializeBatchTextOps creates text ops with correct style from global + template", () => {
    const region = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };
    useEditorStore.setState({
      queue: [queueItem(0)],
      templateRegions: [
        {
          id: "r1",
          label: "TEXT_1",
          region,
          style: { fontSize: 48, fontColor: "#ff0000", textShadowOffsetX: 6 },
        },
      ],
      excelRows: [{ id: "video_0", TEXT_1: "Nombre" }],
      excelMapping: { idColumn: "id", columns: { r1: "TEXT_1" } },
      // Global style
      textFontSize: 32,
      textFontColor: "white",
      fontFamily: "Arial",
      fontWeight: 700,
      letterSpacing: 4,
      textAlign: "center",
      textOpacity: 0.75,
      bold: true,
      bgEnabled: true,
      bgColor: "black",
      bgOpacity: 0.65,
      boxBorderWidth: 4,
      borderWidth: 2,
      borderColor: "white",
      textShadowEnabled: true,
      textShadowColor: "#000000",
      textShadowOffsetX: 2,
      textShadowOffsetY: 3,
    });

    useEditorStore.getState().materializeBatchTextOps();
    const ops = useEditorStore.getState().queue[0].operations;

    expect(ops).toHaveLength(1);
    expect(ops[0].mode).toBe("text");
    expect(ops[0].text).toBe("Nombre");
    // Template style overrides global
    expect(ops[0].fontSize).toBe(48);
    expect(ops[0].fontColor).toBe("#ff0000");
    // Global style fills in what template didn't specify
    expect(ops[0].fontWeight).toBe(700);
    expect(ops[0].letterSpacing).toBe(4);
    expect(ops[0].textAlign).toBe("center");
    expect(ops[0].textOpacity).toBe(0.75);
    expect(ops[0].bold).toBe(true);
    expect(ops[0].bgEnabled).toBe(true);
    expect(ops[0].bgColor).toBe("black");
    expect(ops[0].bgOpacity).toBe(0.65);
    expect(ops[0].boxBorderWidth).toBe(4);
    expect(ops[0].borderWidth).toBe(2);
    expect(ops[0].borderColor).toBe("white");
    expect(ops[0].textShadowEnabled).toBe(true);
    expect(ops[0].textShadowColor).toBe("#000000");
    expect(ops[0].textShadowOffsetX).toBe(6);
    expect(ops[0].textShadowOffsetY).toBe(3);
  });

  it("_reapplyExcel produces same text ops as before the refactor", () => {
    const region = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };
    useEditorStore.setState({
      queue: [queueItem(0)],
      templateRegions: [
        { id: "r1", label: "TEXT_1", region, style: { fontSize: 44, fontColor: "#abcdef" } },
      ],
      excelRows: [{ id: "video_0", TEXT_1: "Hola Mundo" }],
      excelMapping: { idColumn: "id", columns: { r1: "TEXT_1" } },
      fontWeight: 700,
      letterSpacing: 4,
      textAlign: "center",
      textOpacity: 0.75,
      boxBorderWidth: 9,
    });

    const report = useEditorStore.getState()._reapplyExcel();
    expect(report.matched).toBe(1);
    const op = useEditorStore.getState().queue[0].operations[0];

    // This matches the exact assertion from the original store.logic.test.js
    expect(op.text).toBe("Hola Mundo");
    expect(op.fontWeight).toBe(700);
    expect(op.letterSpacing).toBe(4);
    expect(op.textAlign).toBe("center");
    expect(op.textOpacity).toBe(0.75);
    expect(op.boxBorderWidth).toBe(9);
    // Template-specific overrides
    expect(op.fontSize).toBe(44);
    expect(op.fontColor).toBe("#abcdef");
  });

  it("export pipeline uses the per-video moved batch text region", () => {
    const templateRegion = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };
    const movedRegion = { x: 0.4, y: 0.3, w: 0.3, h: 0.1 };
    useEditorStore.setState({
      queue: [
        queueItem(0, {
          operations: [
            {
              id: "text-1",
              mode: "text",
              batchRegionId: "r1",
              region: movedRegion,
              text: "Watermark",
              fontSize: 36,
              fontColor: "white",
            },
          ],
        }),
      ],
      templateRegions: [{ id: "r1", label: "TEXT_1", region: templateRegion }],
      excelRows: [{ id: "video_0", TEXT_1: "Watermark" }],
      excelMapping: { idColumn: "id", columns: { r1: "TEXT_1" } },
    });

    useEditorStore.getState().materializeBatchTextOps();
    const job = useEditorStore.getState()._buildJobFor(useEditorStore.getState().queue[0], 0);

    expect(job.operations).toHaveLength(1);
    expect(job.operations[0].mode).toBe("text");
    expect(job.operations[0].region.x).toBe(768);
    expect(job.operations[0].region.y).toBe(324);
    expect(job.operations[0].region.w).toBe(576);
    expect(job.operations[0].region.h).toBe(108);
  });

  it("export pipeline: batch text + delogo ops produce valid Python job", () => {
    const textRegion = { x: 0.1, y: 0.8, w: 0.5, h: 0.1 };
    const delogoRegion = { x: 0.7, y: 0.0, w: 0.15, h: 0.05 };
    useEditorStore.setState({
      queue: [
        queueItem(0, {
          operations: [
            {
              id: "delogo-1",
              mode: "delogo",
              region: delogoRegion,
              delogoMethod: "inpaint",
              edgeFeather: 4,
            },
            {
              id: "text-1",
              mode: "text",
              region: textRegion,
              text: "Watermark",
              fontSize: 36,
              fontColor: "white",
              fontWeight: 600,
              letterSpacing: 1,
              textAlign: "center",
              textOpacity: 0.9,
              bold: false,
              bgEnabled: true,
              bgColor: "black",
              bgOpacity: 0.5,
              boxBorderWidth: 5,
              borderWidth: 0,
              borderColor: "black",
            },
          ],
        }),
      ],
      templateRegions: [{ id: "r1", label: "TEXT_1", region: textRegion }],
      excelRows: [{ id: "video_0", TEXT_1: "Watermark" }],
      excelMapping: { idColumn: "id", columns: { r1: "TEXT_1" } },
    });

    const job = useEditorStore.getState()._buildJobFor(useEditorStore.getState().queue[0], 0);

    expect(job).not.toBeNull();
    expect(job.operations).toHaveLength(2);

    // Delogo op
    const delogo = job.operations[0];
    expect(delogo.mode).toBe("delogo");
    expect(delogo.delogo_method).toBe("inpaint");
    expect(delogo.edge_feather).toBe(4);
    expect(delogo.region.x).toBe(1344); // 0.7 * 1920
    expect(delogo.region.y).toBe(0); // 0.0 * 1080
    expect(delogo.region.w).toBe(288); // 0.15 * 1920
    expect(delogo.region.h).toBe(54); // 0.05 * 1080 (may be rounded)

    // Text op
    const text = job.operations[1];
    expect(text.mode).toBe("text");
    expect(text.text).toBe("Watermark");
    expect(text.font_size).toBe(36);
    expect(text.font_weight).toBe(600);
    expect(text.letter_spacing).toBe(1);
    expect(text.text_align).toBe("center");
    expect(text.text_opacity).toBe(0.9);
    expect(text.bg_enabled).toBe(true);
    expect(text.bg_color).toBe("black");
    expect(text.bg_opacity).toBe(0.5);
    expect(text.box_border_width).toBe(5);
    // Denormalized region
    expect(text.region.x).toBe(192); // 0.1 * 1920
    expect(text.region.y).toBe(864); // 0.8 * 1080
  });

  it("Python build_drawtext escapes braces correctly", async () => {
    const region = { x: 0.1, y: 0.1, w: 0.3, h: 0.1 };
    useEditorStore.setState({
      queue: [
        queueItem(0, {
          operations: [
            {
              id: "text-brace",
              mode: "text",
              region,
              text: "Price: ${99}",
              fontSize: 32,
              fontColor: "white",
              fontFamily: "Arial",
            },
          ],
        }),
      ],
    });

    const job = useEditorStore.getState()._buildJobFor(useEditorStore.getState().queue[0], 0);
    // The JS side sends the text as-is; Python escapes it during build_drawtext
    expect(job.operations[0].text).toBe("Price: ${99}");

    // Verify Python handles the escaping (use raw string to avoid JS interpolation)
    const { spawnSync } = await import("child_process");
    const r = spawnSync(
      "py",
      [
        "-3",
        "-c",
        [
          "import sys; sys.path.insert(0, 'python')",
          "import processor",
          "result = processor.build_drawtext({'text': 'Price: ${99}', 'region': {'x': 100, 'y': 100, 'w': 200, 'h': 50}, 'font_size': 32, 'font_color': 'white', 'font_family': 'Arial'})",
          "print(result is not None and '\\\\{' in result and '\\\\}' in result)",
        ].join("\n"),
      ],
      { encoding: "utf8", timeout: 10000 },
    );
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("True");
  });

  it("filterOperationsForExport drops blank text ops but keeps delogo ops", () => {
    const ops = [
      { mode: "delogo", region: { x: 0.1, y: 0.1, w: 0.2, h: 0.1 }, delogoMethod: "inpaint" },
      { mode: "text", region: { x: 0.5, y: 0.5, w: 0.2, h: 0.1 }, text: "" },
      { mode: "text", region: { x: 0.6, y: 0.6, w: 0.2, h: 0.1 }, text: "Hello" },
      { mode: "blur", region: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 }, blurStrength: 20 },
    ];
    const filtered = filterOperationsForExport(ops);
    expect(filtered).toHaveLength(3);
    expect(filtered[0].mode).toBe("delogo");
    expect(filtered[1].mode).toBe("text");
    expect(filtered[1].text).toBe("Hello");
    expect(filtered[2].mode).toBe("blur");
  });

  it("preserves non-text ops when _reapplyExcel creates text ops", () => {
    const textRegion = { x: 0.1, y: 0.8, w: 0.3, h: 0.1 };
    const blurRegion = { x: 0.5, y: 0.5, w: 0.2, h: 0.1 };
    useEditorStore.setState({
      queue: [
        queueItem(0, {
          operations: [{ id: "blur-1", mode: "blur", region: blurRegion, blurStrength: 25 }],
        }),
      ],
      templateRegions: [{ id: "r1", label: "TEXT_1", region: textRegion }],
      excelRows: [{ id: "video_0", TEXT_1: "Batch Text" }],
      excelMapping: { idColumn: "id", columns: { r1: "TEXT_1" } },
    });

    const report = useEditorStore.getState()._reapplyExcel();
    expect(report.matched).toBe(1);
    const ops = useEditorStore.getState().queue[0].operations;

    // Blur op should be preserved
    expect(ops).toHaveLength(2);
    expect(ops[0].mode).toBe("blur");
    expect(ops[0].blurStrength).toBe(25);
    // Text op should be created
    expect(ops[1].mode).toBe("text");
    expect(ops[1].text).toBe("Batch Text");
  });

  it("materializeBatchTextOps preserves non-text ops", () => {
    const textRegion = { x: 0.1, y: 0.8, w: 0.3, h: 0.1 };
    const delogoRegion = { x: 0.7, y: 0.0, w: 0.15, h: 0.05 };
    useEditorStore.setState({
      queue: [
        queueItem(0, {
          operations: [
            {
              id: "delogo-1",
              mode: "delogo",
              region: delogoRegion,
              delogoMethod: "blur",
              blurStrength: 20,
            },
          ],
        }),
      ],
      templateRegions: [{ id: "r1", label: "TEXT_1", region: textRegion }],
      excelRows: [{ id: "video_0", TEXT_1: "Title" }],
      excelMapping: { idColumn: "id", columns: { r1: "TEXT_1" } },
    });

    useEditorStore.getState().materializeBatchTextOps();
    const ops = useEditorStore.getState().queue[0].operations;

    expect(ops).toHaveLength(2);
    expect(ops[0].mode).toBe("delogo");
    expect(ops[0].delogoMethod).toBe("blur");
    expect(ops[1].mode).toBe("text");
    expect(ops[1].text).toBe("Title");
  });

  it("full pipeline: 5 videos with mixed delogo + batch text", () => {
    const textRegion = { x: 0.1, y: 0.8, w: 0.3, h: 0.1 };
    const delogoRegion = { x: 0.7, y: 0.0, w: 0.15, h: 0.05 };
    const items = Array.from({ length: 5 }, (_, i) =>
      queueItem(i, {
        operations: [
          { id: `delogo-${i}`, mode: "delogo", region: delogoRegion, delogoMethod: "inpaint" },
        ],
      }),
    );

    useEditorStore.setState({
      queue: items,
      templateRegions: [{ id: "r1", label: "TEXT_1", region: textRegion, style: { fontSize: 40 } }],
      excelRows: items.map((item, i) => ({ id: `video_${i}`, TEXT_1: `Video ${i}` })),
      excelMapping: { idColumn: "id", columns: { r1: "TEXT_1" } },
    });

    // Step 1: _reapplyExcel creates text ops
    const report = useEditorStore.getState()._reapplyExcel();
    expect(report.matched).toBe(5);

    // Step 2: materialize ensures ops are complete
    useEditorStore.getState().materializeBatchTextOps();

    // Step 3: build jobs
    const jobs = useEditorStore
      .getState()
      .queue.map((item, i) => useEditorStore.getState()._buildJobFor(item, i))
      .filter(Boolean);

    expect(jobs).toHaveLength(5);
    for (const job of jobs) {
      expect(job.operations).toHaveLength(2);
      expect(job.operations[0].mode).toBe("delogo");
      expect(job.operations[0].delogo_method).toBe("inpaint");
      expect(job.operations[1].mode).toBe("text");
      expect(job.operations[1].font_size).toBe(40); // from template style
    }

    // Verify the text content varies per video
    expect(jobs[0].operations[1].text).toBe("Video 0");
    expect(jobs[4].operations[1].text).toBe("Video 4");

    // Verify delogo regions are denormalized
    expect(jobs[0].operations[0].region.x).toBe(1344);
    expect(jobs[0].operations[0].region.y).toBe(0);
  });
});
