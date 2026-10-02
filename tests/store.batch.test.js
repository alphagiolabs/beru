import { describe, it, expect, beforeEach } from "vitest";
import { prepareRun } from "../src/utils/export-run.js";
import { createMockApi, installMockApi, makeQueueItem, resetEditorState } from "./helpers/store.js";

const mockApi = installMockApi(createMockApi());

const { default: useEditorStore } = await import("../src/stores/useEditorStore.js");

describe("batchSlice", () => {
  beforeEach(() => resetEditorState(useEditorStore, mockApi));

  it("uses ID_TEXT as the output name for batch text jobs", () => {
    useEditorStore.setState({
      queue: [makeQueueItem({ path: "C:\\videos\\promo.mp4", filename: "promo.mp4" })],
      outputDir: "C:\\output",
      templateRegions: [
        { id: "region-1", label: "TEXT_1", region: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 } },
      ],
      excelRows: [{ id: "promo.mp4", TEXT_1: "Oferta: 50% / hoy" }],
      excelMapping: { idColumn: "id", columns: { "region-1": "TEXT_1" } },
    });

    useEditorStore
      .getState()
      .updateExcelMapping({ idColumn: "id", columns: { "region-1": "TEXT_1" } });
    const s = useEditorStore.getState();
    const job = prepareRun({
      queue: s.queue,
      videoIdx: 0,
      outputPaths: s.outputPathsForAll(),
    }).jobs[0];

    expect(job.output_path).toBe("C:\\output\\promo_Oferta 50% hoy.mp4");
  });

  it("uses the first non-empty batch text when TEXT_1 is empty", () => {
    useEditorStore.setState({
      queue: [makeQueueItem({ path: "C:\\videos\\promo.mp4", filename: "promo.mp4" })],
      outputDir: "C:\\output",
      templateRegions: [
        { id: "region-1", label: "TEXT_1", region: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 } },
        { id: "region-2", label: "TEXT_2", region: { x: 0.1, y: 0.4, w: 0.3, h: 0.1 } },
      ],
      excelRows: [{ id: "promo", TEXT_1: "", TEXT_2: "Subtitulo" }],
      excelMapping: { idColumn: "id", columns: { "region-1": "TEXT_1", "region-2": "TEXT_2" } },
    });

    useEditorStore.getState().updateExcelMapping({
      idColumn: "id",
      columns: { "region-1": "TEXT_1", "region-2": "TEXT_2" },
    });
    const s = useEditorStore.getState();
    const job = prepareRun({
      queue: s.queue,
      videoIdx: 0,
      outputPaths: s.outputPathsForAll(),
    }).jobs[0];

    expect(job.output_path).toBe("C:\\output\\promo_Subtitulo.mp4");
  });

  it("reapplies Excel rows using advanced text style defaults", () => {
    useEditorStore.setState({
      queue: [makeQueueItem()],
      templateRegions: [
        { id: "region-1", label: "TEXT_1", region: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 } },
      ],
      excelRows: [{ id: "sample", TEXT_1: "Hola" }],
      excelMapping: { idColumn: "id", columns: { "region-1": "TEXT_1" } },
      fontWeight: 700,
      letterSpacing: 4,
      textAlign: "center",
      textOpacity: 0.75,
      boxBorderWidth: 9,
      textShadowEnabled: true,
      textShadowColor: "#111111",
      textShadowOffsetX: 3,
      textShadowOffsetY: 4,
    });

    useEditorStore
      .getState()
      .updateExcelMapping({ idColumn: "id", columns: { "region-1": "TEXT_1" } });
    const op = useEditorStore.getState().queue[0].operations[0];

    expect(useEditorStore.getState().excelMatchStatus).toEqual({ 0: "matched" });
    expect(op).toEqual(
      expect.objectContaining({
        text: "Hola",
        fontWeight: 700,
        letterSpacing: 4,
        textAlign: "center",
        textOpacity: 0.75,
        boxBorderWidth: 9,
        textShadowEnabled: true,
        textShadowColor: "#111111",
        textShadowOffsetX: 3,
        textShadowOffsetY: 4,
      }),
    );
  });

  it("getBatchPreviewPayload returns Excel text without a text operation", () => {
    useEditorStore.setState({
      queue: [makeQueueItem()],
      templateRegions: [
        {
          id: "region-1",
          label: "TEXT_1",
          region: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 },
          style: { fontSize: 48, fontColor: "#ff0000" },
        },
      ],
      excelRows: [{ id: "sample", TEXT_1: "Desde Excel" }],
      excelMapping: { idColumn: "id", columns: { "region-1": "TEXT_1" } },
      sidebarMode: "batch",
    });

    const payload = useEditorStore.getState().getBatchPreviewPayload(0, "region-1");

    expect(payload.text).toBe("Desde Excel");
    expect(payload.style.fontSize).toBe(48);
    expect(payload.style.fontColor).toBe("#ff0000");
  });

  it("patchBatchTextStyle updates template region style and matching ops in the queue", () => {
    const region = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };
    useEditorStore.setState({
      sidebarMode: "batch",
      selectedTemplateRegionId: "region-1",
      templateRegions: [{ id: "region-1", label: "TEXT_1", region, style: { fontSize: 32 } }],
      queue: [
        makeQueueItem({
          operations: [
            {
              id: "op-1",
              mode: "text",
              region: { ...region },
              text: "A",
              fontSize: 32,
              fontColor: "white",
            },
          ],
        }),
        makeQueueItem({
          path: "C:\\videos\\b.mp4",
          filename: "b.mp4",
          operations: [
            {
              id: "op-2",
              mode: "text",
              region: { ...region },
              text: "B",
              fontSize: 32,
              fontColor: "white",
            },
          ],
        }),
      ],
    });

    useEditorStore.getState().patchBatchTextStyle({
      fontSize: 64,
      fontColor: "#00ff00",
      textShadowEnabled: true,
      textShadowOffsetY: 6,
    });

    const state = useEditorStore.getState();
    expect(state.textFontSize).toBe(64);
    expect(state.textFontColor).toBe("#00ff00");
    expect(state.templateRegions[0].style.fontSize).toBe(64);
    expect(state.templateRegions[0].style.textShadowEnabled).toBe(true);
    expect(state.templateRegions[0].style.textShadowOffsetY).toBe(6);
    expect(state.queue[0].operations[0].fontSize).toBe(64);
    expect(state.queue[1].operations[0].fontColor).toBe("#00ff00");
    expect(state.queue[1].operations[0].textShadowEnabled).toBe(true);
    expect(state.queue[1].operations[0].textShadowOffsetY).toBe(6);
  });

  it("updateTemplateRegion resizes the selected batch region and matching queue text ops", () => {
    const region = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };
    const resized = { x: 0.1, y: 0.2, w: 0.5, h: 0.16 };
    useEditorStore.setState({
      selectedTemplateRegionId: "region-1",
      templateRegions: [{ id: "region-1", label: "TEXT_1", region, style: { fontSize: 32 } }],
      queue: [
        makeQueueItem({
          operations: [
            {
              id: "op-1",
              mode: "text",
              batchRegionId: "region-1",
              region: { ...region },
              text: "A",
              fontSize: 32,
            },
          ],
        }),
      ],
    });

    useEditorStore.getState().updateTemplateRegion("region-1", {
      region: resized,
      fontSize: 48,
      textWrap: false,
      truncate: "ellipsis",
    });

    const state = useEditorStore.getState();
    expect(state.templateRegions[0].region).toEqual(resized);
    expect(state.templateRegions[0].style).toEqual(
      expect.objectContaining({ fontSize: 48, textWrap: false, truncate: "ellipsis" }),
    );
    expect(state.queue[0].operations[0]).toEqual(
      expect.objectContaining({
        region: resized,
        fontSize: 48,
        textWrap: false,
        truncate: "ellipsis",
      }),
    );
  });

  it("setSelectedTemplateRegion loads the template region into currentRegion", () => {
    const region = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };
    useEditorStore.setState({
      sidebarMode: "batch",
      templateRegions: [{ id: "region-1", label: "TEXT_1", region, style: { fontSize: 32 } }],
      selectedTemplateRegionId: null,
      currentRegion: null,
    });

    useEditorStore.getState().setSelectedTemplateRegion("region-1");
    const state = useEditorStore.getState();

    expect(state.selectedTemplateRegionId).toBe("region-1");
    expect(state.currentRegion).toEqual(region);
  });

  it("setCurrentRegion in batch mode syncs resize to template region and queue ops", () => {
    const region = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };
    const resized = { x: 0.12, y: 0.22, w: 0.5, h: 0.16 };
    useEditorStore.setState({
      sidebarMode: "batch",
      selectedTemplateRegionId: "region-1",
      currentRegion: { ...region },
      templateRegions: [{ id: "region-1", label: "TEXT_1", region, style: { fontSize: 32 } }],
      queue: [
        makeQueueItem({
          width: 1920,
          height: 1080,
          operations: [
            {
              id: "op-1",
              mode: "text",
              batchRegionId: "region-1",
              region: { ...region },
              text: "A",
            },
          ],
        }),
      ],
    });

    useEditorStore.getState().setCurrentRegion(resized);
    const state = useEditorStore.getState();

    expect(state.currentRegion).toEqual(resized);
    expect(state.templateRegions[0].region).toEqual(resized);
    expect(state.queue[0].operations[0].region).toEqual(resized);
  });

  it("setCurrentRegion(null) in batch mode keeps selectedTemplateRegionId", () => {
    useEditorStore.setState({
      sidebarMode: "batch",
      selectedTemplateRegionId: "region-1",
      currentRegion: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 },
      templateRegions: [
        { id: "region-1", label: "TEXT_1", region: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 } },
      ],
    });

    useEditorStore.getState().setCurrentRegion(null);
    const state = useEditorStore.getState();

    expect(state.currentRegion).toBeNull();
    expect(state.selectedTemplateRegionId).toBe("region-1");
  });

  it("cancelBatchRegionSelection clears currentRegion and selectedTemplateRegionId", () => {
    useEditorStore.setState({
      sidebarMode: "batch",
      selectedTemplateRegionId: "region-1",
      currentRegion: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 },
      templateRegions: [
        { id: "region-1", label: "TEXT_1", region: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 } },
      ],
    });

    useEditorStore.getState().cancelBatchRegionSelection();
    const state = useEditorStore.getState();

    expect(state.currentRegion).toBeNull();
    expect(state.selectedTemplateRegionId).toBeNull();
  });

  it("setSelectedTemplateRegion uses per-video moved region for canvas handles", () => {
    const templateRegion = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };
    const movedRegion = { x: 0.35, y: 0.28, w: 0.3, h: 0.1 };
    useEditorStore.setState({
      sidebarMode: "batch",
      selectedIdx: 0,
      templateRegions: [{ id: "region-1", label: "TEXT_1", region: templateRegion }],
      queue: [
        makeQueueItem({
          operations: [
            {
              id: "op-1",
              mode: "text",
              batchRegionId: "region-1",
              region: movedRegion,
              text: "Hola",
            },
          ],
        }),
      ],
    });

    useEditorStore.getState().setSelectedTemplateRegion("region-1");
    expect(useEditorStore.getState().currentRegion).toEqual(movedRegion);
  });

  it("starting a fresh canvas draw in batch mode deselects the template region", () => {
    useEditorStore.setState({
      sidebarMode: "batch",
      selectedTemplateRegionId: "region-1",
      currentRegion: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 },
      templateRegions: [
        { id: "region-1", label: "TEXT_1", region: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 } },
      ],
    });

    useEditorStore.getState().setCurrentRegion({ x: 0.4, y: 0.5, w: 0, h: 0 });
    const state = useEditorStore.getState();

    expect(state.selectedTemplateRegionId).toBeNull();
    expect(state.currentRegion).toEqual(
      expect.objectContaining({ x: 0.4, y: 0.5, w: 0.01, h: 0.01 }),
    );
  });

  it("reapplying Excel preserves an individually moved batch text region", () => {
    const templateRegion = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };
    const movedRegion = { x: 0.35, y: 0.28, w: 0.3, h: 0.1 };
    useEditorStore.setState({
      queue: [
        makeQueueItem({
          operations: [
            {
              id: "op-1",
              mode: "text",
              batchRegionId: "region-1",
              region: movedRegion,
              text: "Antes",
              fontSize: 32,
              fontColor: "white",
            },
          ],
        }),
      ],
      templateRegions: [{ id: "region-1", label: "TEXT_1", region: templateRegion }],
      excelRows: [{ id: "sample", TEXT_1: "Desde Excel" }],
      excelMapping: { idColumn: "id", columns: { "region-1": "TEXT_1" } },
    });

    useEditorStore
      .getState()
      .updateExcelMapping({ idColumn: "id", columns: { "region-1": "TEXT_1" } });
    const op = useEditorStore.getState().queue[0].operations[0];
    const payload = useEditorStore.getState().getBatchPreviewPayload(0, "region-1");

    expect(op.batchRegionId).toBe("region-1");
    expect(op.text).toBe("Desde Excel");
    expect(op.region).toEqual(movedRegion);
    expect(payload.region).toEqual(movedRegion);
  });

  it("syncs edited moved batch text back to Excel through batchRegionId", () => {
    const templateRegion = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };
    const movedRegion = { x: 0.35, y: 0.28, w: 0.3, h: 0.1 };
    useEditorStore.setState({
      queue: [
        makeQueueItem({
          operations: [
            {
              id: "op-1",
              mode: "text",
              batchRegionId: "region-1",
              region: movedRegion,
              text: "Antes",
            },
          ],
        }),
      ],
      templateRegions: [{ id: "region-1", label: "TEXT_1", region: templateRegion }],
      excelRows: [{ id: "sample", TEXT_1: "Antes" }],
      excelMapping: { idColumn: "id", columns: { "region-1": "TEXT_1" } },
    });

    useEditorStore.getState().updateOperationText(0, 0, "Despues");

    expect(useEditorStore.getState().excelRows[0].TEXT_1).toBe("Despues");
  });

  it("setTextForRegion materializes an op seeded from the Excel cell", () => {
    const region = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };
    useEditorStore.setState({
      queue: [makeQueueItem()],
      selectedIdx: 0,
      templateRegions: [{ id: "region-1", label: "TEXT_1", region, style: { fontSize: 48 } }],
      excelRows: [{ id: "sample", TEXT_1: "Desde Excel" }],
      excelMapping: { idColumn: "id", columns: { "region-1": "TEXT_1" } },
    });

    const opIdx = useEditorStore.getState().setTextForRegion(0, "region-1");
    const state = useEditorStore.getState();

    expect(opIdx).toBe(0);
    expect(state.queue[0].operations[0]).toEqual(
      expect.objectContaining({
        mode: "text",
        batchRegionId: "region-1",
        region,
        text: "Desde Excel",
        fontSize: 48,
      }),
    );
  });

  it("setTextForRegion updates an existing op and syncs Excel", () => {
    const region = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };
    useEditorStore.setState({
      queue: [
        makeQueueItem({
          operations: [
            {
              id: "op-1",
              mode: "text",
              batchRegionId: "region-1",
              region: { ...region },
              text: "Antes",
            },
          ],
        }),
      ],
      templateRegions: [{ id: "region-1", label: "TEXT_1", region }],
      excelRows: [{ id: "sample", TEXT_1: "Antes" }],
      excelMapping: { idColumn: "id", columns: { "region-1": "TEXT_1" } },
    });

    const opIdx = useEditorStore.getState().setTextForRegion(0, "region-1", "Nuevo");
    const state = useEditorStore.getState();

    expect(opIdx).toBe(0);
    expect(state.queue[0].operations).toHaveLength(1);
    expect(state.queue[0].operations[0].text).toBe("Nuevo");
    expect(state.excelRows[0].TEXT_1).toBe("Nuevo");
  });

  it("setTextForRegion creates the op when committing non-empty text", () => {
    const region = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };
    useEditorStore.setState({
      queue: [makeQueueItem()],
      templateRegions: [{ id: "region-1", label: "TEXT_1", region }],
      excelRows: [{ id: "sample", TEXT_1: "" }],
      excelMapping: { idColumn: "id", columns: { "region-1": "TEXT_1" } },
    });

    const opIdx = useEditorStore.getState().setTextForRegion(0, "region-1", "Hola");
    const state = useEditorStore.getState();

    expect(opIdx).toBe(0);
    expect(state.queue[0].operations[0]).toEqual(
      expect.objectContaining({ mode: "text", batchRegionId: "region-1", text: "Hola" }),
    );
    expect(state.excelRows[0].TEXT_1).toBe("Hola");
  });

  it("setTextForRegion with empty text and no op only clears the Excel cell", () => {
    const region = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };
    useEditorStore.setState({
      queue: [makeQueueItem()],
      templateRegions: [{ id: "region-1", label: "TEXT_1", region }],
      excelRows: [{ id: "sample", TEXT_1: "Viejo" }],
      excelMapping: { idColumn: "id", columns: { "region-1": "TEXT_1" } },
    });

    const opIdx = useEditorStore.getState().setTextForRegion(0, "region-1", "");
    const state = useEditorStore.getState();

    expect(opIdx).toBe(-1);
    expect(state.queue[0].operations).toHaveLength(0);
    expect(state.excelRows[0].TEXT_1).toBe("");
  });

  it("setTextForRegion materializes as a single undo step", () => {
    const region = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };
    useEditorStore.setState({
      queue: [makeQueueItem()],
      selectedIdx: 0,
      undoStack: [],
      templateRegions: [{ id: "region-1", label: "TEXT_1", region }],
      excelRows: [{ id: "sample", TEXT_1: "Desde Excel" }],
      excelMapping: { idColumn: "id", columns: { "region-1": "TEXT_1" } },
    });

    useEditorStore.getState().setTextForRegion(0, "region-1");
    expect(useEditorStore.getState().undoStack).toHaveLength(1);

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().queue[0].operations).toHaveLength(0);
  });

  it("setTextForRegion rejects unknown videos and regions", () => {
    useEditorStore.setState({
      queue: [makeQueueItem()],
      templateRegions: [
        { id: "region-1", label: "TEXT_1", region: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 } },
      ],
    });
    const before = useEditorStore.getState().queue;

    expect(useEditorStore.getState().setTextForRegion(5, "region-1", "x")).toBe(-1);
    expect(useEditorStore.getState().setTextForRegion(0, "nope", "x")).toBe(-1);
    expect(useEditorStore.getState().queue).toBe(before);
  });

  it("updates only the specific video operation and currentRegion when dragging batch overlay (per-video positioning)", () => {
    const templateRegion = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };
    const nextRegion = { x: 0.4, y: 0.4, w: 0.3, h: 0.1 };
    useEditorStore.setState({
      sidebarMode: "batch",
      selectedIdx: 0,
      selectedTemplateRegionId: "region-1",
      currentRegion: { ...templateRegion },
      templateRegions: [{ id: "region-1", label: "TEXT_1", region: templateRegion }],
      queue: [
        makeQueueItem({
          operations: [
            {
              id: "op-1",
              mode: "text",
              batchRegionId: "region-1",
              region: { ...templateRegion },
              text: "Video 1",
            },
          ],
        }),
        makeQueueItem({
          operations: [
            {
              id: "op-2",
              mode: "text",
              batchRegionId: "region-1",
              region: { ...templateRegion },
              text: "Video 2",
            },
          ],
        }),
      ],
    });

    useEditorStore.getState().updateOperation(0, 0, { region: nextRegion });
    useEditorStore.setState({ currentRegion: nextRegion });

    const state = useEditorStore.getState();
    expect(state.currentRegion).toEqual(nextRegion);
    expect(state.queue[0].operations[0].region).toEqual(nextRegion);
    expect(state.templateRegions[0].region).toEqual(templateRegion);
    expect(state.queue[1].operations[0].region).toEqual(templateRegion);
  });

  it("removes moved batch text operations when deleting their template region", () => {
    const removedTemplateRegion = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };
    const movedRegion = { x: 0.35, y: 0.28, w: 0.3, h: 0.1 };
    useEditorStore.setState({
      queue: [
        makeQueueItem({
          operations: [
            {
              id: "batch-op",
              mode: "text",
              batchRegionId: "region-1",
              region: movedRegion,
              text: "Se borra",
            },
            {
              id: "manual-op",
              mode: "text",
              region: { x: 0.7, y: 0.7, w: 0.2, h: 0.1 },
              text: "Se queda",
            },
            {
              id: "blur-op",
              mode: "blur",
              region: { x: 0, y: 0, w: 0.1, h: 0.1 },
              blurStrength: 20,
            },
          ],
        }),
      ],
      templateRegions: [
        { id: "region-1", label: "TEXT_1", region: removedTemplateRegion },
        { id: "region-2", label: "TEXT_2", region: { x: 0.5, y: 0.2, w: 0.3, h: 0.1 } },
      ],
      selectedTemplateRegionId: "region-1",
      excelMapping: { idColumn: "id", columns: { "region-1": "TEXT_1", "region-2": "TEXT_2" } },
    });

    useEditorStore.getState().removeTemplateRegion("region-1");
    const state = useEditorStore.getState();

    expect(state.templateRegions.map((r) => r.id)).toEqual(["region-2"]);
    expect(state.selectedTemplateRegionId).toBe("region-2");
    expect(state.excelMapping.columns).toEqual({ "region-2": "TEXT_2" });
    expect(state.queue[0].operations.map((op) => op.id)).toEqual(["manual-op", "blur-op"]);
  });

  it("addTemplateRegion stores batch text regions from the current selection", () => {
    const region = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };
    useEditorStore.setState({
      sidebarMode: "batch",
      activeTool: "text",
      currentRegion: region,
      templateRegions: [],
      nextRegionLabel: 1,
    });

    useEditorStore.getState().addTemplateRegion();
    const state = useEditorStore.getState();

    expect(state.templateRegions).toHaveLength(1);
    expect(state.templateRegions[0].label).toBe("TEXT_1");
    expect(state.templateRegions[0].region).toEqual(region);
    expect(state.currentRegion).toBeNull();
  });
});
