import { describe, it, expect, vi, beforeEach } from "vitest";
import useEditorStore from "../src/stores/useEditorStore.js";
import { parseSessionSnapshot } from "../src/utils/session-persist.js";

// Integrated baseline: a restored session (operations, Excel mapping and a template text slot)
// exported through the real processAll path. Only the processor manifest is captured.

const MEDIA = "C:\\qa-baseline\\media";
const OUT = "C:\\qa-baseline\\out";

const base = {
  blurStrength: 20,
  delogoMethod: "blur",
  delogoFillColor: "black",
  delogoFillOpacity: 1,
  delogoImagePath: "",
  delogoImageV: "",
  temporalRadius: 3,
  mosaicSize: 12,
  mirrorSide: "right",
  edgeFeather: 6,
  text: "",
  batchRegionId: null,
  imagePath: "",
  imageV: "",
  imageOpacity: 1,
  endTime: null,
};

const snapshot = {
  version: 1,
  queue: [
    {
      path: `${MEDIA}\\testsrc2-1280x720.mp4`,
      src: "http://localhost:5174/testsrc2-1280x720.mp4",
      filename: "testsrc2-1280x720.mp4",
      width: 1280,
      height: 720,
      sourceWidth: 1280,
      sourceHeight: 720,
      duration: 6,
      pixFmt: "yuv420p",
      frameRate: 30,
      videoCodec: "h264",
      audioCodec: "",
      audioChannels: 0,
      trimStart: null,
      trimEnd: null,
      operations: [
        {
          ...base,
          id: "crop916",
          mode: "crop",
          region: { x: 256 / 1280, y: 0, w: 405 / 1280, h: 1 },
          startTime: null,
        },
      ],
      customOutputName: "",
    },
    {
      path: `${MEDIA}\\logos-640x360.mp4`,
      src: "http://localhost:5174/logos-640x360.mp4",
      filename: "logos-640x360.mp4",
      width: 640,
      height: 360,
      sourceWidth: 640,
      sourceHeight: 360,
      duration: 5,
      pixFmt: "yuv420p",
      frameRate: 30,
      videoCodec: "h264",
      audioCodec: "",
      audioChannels: 0,
      trimStart: null,
      trimEnd: null,
      operations: [
        {
          ...base,
          id: "blurWindow",
          mode: "blur",
          region: { x: 19 / 640, y: 18 / 360, w: 96 / 640, h: 43 / 360 },
          startTime: 1,
          endTime: 2,
        },
      ],
      customOutputName: "",
    },
  ],
  outputDir: OUT,
  templateRegions: [
    { id: 1, region: { x: 0.55, y: 0.8, w: 0.4, h: 0.1 }, label: "TEXT_1", style: {} },
  ],
  selectedTemplateRegionId: null,
  nextRegionLabel: 2,
  excelPath: "C:\\qa-baseline\\ids.xlsx",
  excelHeaders: ["ID", "TEXTO"],
  excelRows: [
    { ID: "testsrc2-1280x720", TEXTO: "Hola QA" },
    { ID: "logos-640x360", TEXTO: "Marca Beru" },
  ],
  excelMapping: { idColumn: "ID", columns: { 1: "TEXTO" } },
  watermark: null,
};

const withoutTimestamps = (manifest) => {
  const { createdAt: _createdAt, ...rest } = manifest;
  return {
    ...rest,
    jobs: rest.jobs.map(({ created_at: _created, ...job }) => job),
  };
};

describe("export baseline — restored session through processAll", () => {
  beforeEach(() => {
    const restored = parseSessionSnapshot(snapshot);
    useEditorStore.setState({
      ...restored,
      isProcessing: false,
      undoStack: [],
      redoStack: [],
      currentRegion: null,
      selectedOperationIdx: null,
      sidebarMode: "logo",
    });
  });

  it("produces the processor manifest recorded as the baseline", async () => {
    const startProcessing = vi.fn(async () => ({ success: false, error: "captured" }));
    window.api = { startProcessing };

    await useEditorStore.getState().processAll();

    expect(startProcessing).toHaveBeenCalledTimes(1);
    const manifest = withoutTimestamps(startProcessing.mock.calls[0][0]);
    expect(manifest.jobs[0].operations[0].region).toEqual({ x: 256, y: 0, w: 405, h: 720 });
    expect(manifest.jobs[1].operations[0].region).toEqual({ x: 19, y: 18, w: 96, h: 43 });
    await expect(JSON.stringify(manifest, null, 2)).toMatchFileSnapshot(
      "fixtures/export-baseline/excel-restore.manifest.json",
    );
  });
});
