import { describe, it, expect, beforeEach, vi } from "vitest";
import { filterOperationsForExport } from "../src/utils/operation.js";
import { prepareRun } from "../src/utils/export-run.js";
import { installMockApi, makeQueueItem, resetEditorState } from "./helpers/store.js";

const mockApi = installMockApi({
  startProcessing: vi.fn(async () => ({ success: true })),
  getVideoInfoBatch: vi.fn(async () => []),
});

const { default: useEditorStore } = await import("../src/stores/useEditorStore.js");

const queueItem = (i, overrides = {}) =>
  makeQueueItem({
    path: `C:\\videos\\video_${i}.mp4`,
    src: `beru://local/C%3A%5Cvideos%5Cvideo_${i}.mp4`,
    filename: `video_${i}.mp4`,
    sourceWidth: 1920,
    sourceHeight: 1080,
    duration: 60,
    videoCodec: "h264",
    frameRate: 30,
    audioCodec: "aac",
    ...overrides,
  });

const jobFor = (item, overrides = {}) =>
  prepareRun({
    queue: [item],
    outputPaths: ["C:\\out\\a.mp4"],
    encodeProfile: "balanced",
    ...overrides,
  }).jobs[0];

const exportedJobs = () => mockApi.startProcessing.mock.calls[0][0].jobs;

describe("Export pipeline — Eliminar Logo + Texto en Lote", () => {
  beforeEach(() => {
    resetEditorState(useEditorStore, mockApi, { outputDir: "C:\\output", batchSummary: null });
  });

  it("builds valid delogo job for temporal method", () => {
    const region = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };
    const job = jobFor(
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
    );

    expect(job).not.toBeNull();
    expect(job.operations).toHaveLength(1);
    expect(job.operations[0].region.x).toBe(192);
    expect(job.operations[0].region.y).toBe(216);
    expect(job.operations[0].region.w).toBe(576);
    expect(job.operations[0].region.h).toBe(108);
    expect(job.operations[0].delogo_method).toBe("temporal");
    expect(job.operations[0].temporal_radius).toBe(5);
    expect(job.operations[0].edge_feather).toBe(8);
  });

  it("builds valid delogo job for mirror method", () => {
    const region = { x: 0.5, y: 0.3, w: 0.15, h: 0.1 };
    const job = jobFor(
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
    );
    expect(job.operations[0].delogo_method).toBe("mirror");
    expect(job.operations[0].mirror_side).toBe("left");
  });

  it("builds valid delogo job for inpaint method", () => {
    const region = { x: 0.05, y: 0.05, w: 0.1, h: 0.08 };
    const job = jobFor(
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
    );
    expect(job.operations[0].delogo_method).toBe("inpaint");
  });

  it("simpleDelogo is no longer a recognized field (dead auto-mode removed)", () => {
    const region = { x: 0.1, y: 0.1, w: 0.2, h: 0.1 };
    const job = jobFor(
      queueItem(0, {
        operations: [
          {
            id: "delogo-5",
            mode: "delogo",
            region,
            simpleDelogo: true,
            delogoMethod: "inpaint",
            blurStrength: 2,
            temporalRadius: 999,
            mosaicSize: 200,
            edgeFeather: 100,
            mirrorSide: "left",
            delogoFillColor: "red",
            delogoFillOpacity: 0.5,
          },
        ],
      }),
    );
    expect(job.operations[0].delogo_method).toBe("inpaint");
    expect(job.operations[0].simple_delogo).toBeUndefined();
    expect(job.operations[0].simpleDelogo).toBeUndefined();
  });

  it("builds valid delogo job for cover method", () => {
    const region = { x: 0.2, y: 0.2, w: 0.1, h: 0.1 };
    const job = jobFor(
      queueItem(0, {
        operations: [
          {
            id: "delogo-6",
            mode: "delogo",
            region,
            delogoMethod: "cover",
            delogoImagePath: "C:\\\\img\\\\patch.png",
          },
        ],
      }),
    );
    expect(job.operations[0].delogo_method).toBe("cover");
    expect(job.operations[0].delogo_image_path).toBe("C:\\\\img\\\\patch.png");
  });

  it("cover method falls back to blur when image path is missing", () => {
    const region = { x: 0.2, y: 0.2, w: 0.1, h: 0.1 };
    const job = jobFor(
      queueItem(0, {
        operations: [
          {
            id: "delogo-7",
            mode: "delogo",
            region,
            delogoMethod: "cover",
            delogoImagePath: "",
          },
        ],
      }),
    );
    expect(job.operations[0].delogo_method).toBe("blur");
  });

  it("mixes delogo + blur + text operations in a single job", () => {
    const job = jobFor(
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
    );

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
    expect(ops[0].fontSize).toBe(48);
    expect(ops[0].fontColor).toBe("#ff0000");
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

  it("updateExcelMapping reapplies rows and produces the same text ops", () => {
    const region = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };
    useEditorStore.setState({
      queue: [queueItem(0)],
      templateRegions: [
        { id: "r1", label: "TEXT_1", region, style: { fontSize: 44, fontColor: "#abcdef" } },
      ],
      excelRows: [{ id: "video_0", TEXT_1: "Hola Mundo" }],
      fontWeight: 700,
      letterSpacing: 4,
      textAlign: "center",
      textOpacity: 0.75,
      boxBorderWidth: 9,
    });

    useEditorStore.getState().updateExcelMapping({ idColumn: "id", columns: { r1: "TEXT_1" } });
    expect(useEditorStore.getState().excelMatchStatus[0]).toBe("matched");
    const op = useEditorStore.getState().queue[0].operations[0];

    expect(op.text).toBe("Hola Mundo");
    expect(op.fontWeight).toBe(700);
    expect(op.letterSpacing).toBe(4);
    expect(op.textAlign).toBe("center");
    expect(op.textOpacity).toBe(0.75);
    expect(op.boxBorderWidth).toBe(9);
    expect(op.fontSize).toBe(44);
    expect(op.fontColor).toBe("#abcdef");
  });

  it("export pipeline uses the per-video moved batch text region", async () => {
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

    const res = await useEditorStore.getState().processAll();
    expect(res.ok).toBe(true);
    const job = exportedJobs()[0];

    expect(job.operations).toHaveLength(1);
    expect(job.operations[0].mode).toBe("text");
    expect(job.operations[0].region.x).toBe(768);
    expect(job.operations[0].region.y).toBe(324);
    expect(job.operations[0].region.w).toBe(576);
    expect(job.operations[0].region.h).toBe(108);
  });

  it("export pipeline: batch text + delogo ops produce valid Python job", async () => {
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
          ],
        }),
      ],
      templateRegions: [
        {
          id: "r1",
          label: "TEXT_1",
          region: textRegion,
          style: {
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
        },
      ],
      excelRows: [{ id: "video_0", TEXT_1: "Watermark" }],
    });

    useEditorStore.getState().updateExcelMapping({ idColumn: "id", columns: { r1: "TEXT_1" } });
    const res = await useEditorStore.getState().processAll();
    expect(res.ok).toBe(true);
    const job = exportedJobs()[0];

    expect(job).not.toBeNull();
    expect(job.operations).toHaveLength(2);

    const delogo = job.operations[0];
    expect(delogo.mode).toBe("delogo");
    expect(delogo.delogo_method).toBe("inpaint");
    expect(delogo.edge_feather).toBe(4);
    expect(delogo.region.x).toBe(1344);
    expect(delogo.region.y).toBe(0);
    expect(delogo.region.w).toBe(288);
    expect(delogo.region.h).toBe(54);

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
    expect(text.region.x).toBe(192);
    expect(text.region.y).toBe(864);
  });

  it("Python build_drawtext escapes braces correctly", async () => {
    const region = { x: 0.1, y: 0.1, w: 0.3, h: 0.1 };
    const job = jobFor(
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
    );
    expect(job.operations[0].text).toBe("Price: ${99}");

    const { spawnSync } = await import("child_process");
    const py = "python";
    const r = spawnSync(
      py,
      [
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

  it("preserves non-text ops when a mapping reapply creates text ops", () => {
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
    });

    useEditorStore.getState().updateExcelMapping({ idColumn: "id", columns: { r1: "TEXT_1" } });
    expect(useEditorStore.getState().excelMatchStatus[0]).toBe("matched");
    const ops = useEditorStore.getState().queue[0].operations;

    expect(ops).toHaveLength(2);
    expect(ops[0].mode).toBe("blur");
    expect(ops[0].blurStrength).toBe(25);
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

  it("full pipeline: 5 videos with mixed delogo + batch text", async () => {
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
    });

    useEditorStore.getState().updateExcelMapping({ idColumn: "id", columns: { r1: "TEXT_1" } });
    expect(Object.values(useEditorStore.getState().excelMatchStatus)).toEqual(
      Array(5).fill("matched"),
    );

    const res = await useEditorStore.getState().processAll();
    expect(res.ok).toBe(true);
    const jobs = exportedJobs();

    expect(jobs).toHaveLength(5);
    for (const job of jobs) {
      expect(job.operations).toHaveLength(2);
      expect(job.operations[0].mode).toBe("delogo");
      expect(job.operations[0].delogo_method).toBe("inpaint");
      expect(job.operations[1].mode).toBe("text");
      expect(job.operations[1].font_size).toBe(40);
    }

    expect(jobs[0].operations[1].text).toBe("Video 0");
    expect(jobs[4].operations[1].text).toBe("Video 4");

    expect(jobs[0].operations[0].region.x).toBe(1344);
    expect(jobs[0].operations[0].region.y).toBe(0);
  });
});
