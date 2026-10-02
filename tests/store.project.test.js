import { describe, it, expect, beforeEach } from "vitest";
import { createMockApi, installMockApi, resetEditorState } from "./helpers/store.js";

const mockApi = installMockApi(createMockApi());

const { default: useEditorStore } = await import("../src/stores/useEditorStore.js");

describe("projectSlice + editorStyleSlice", () => {
  beforeEach(() => resetEditorState(useEditorStore, mockApi));

  it("round-trips advanced text style fields in project and preset data", () => {
    useEditorStore.setState({
      fontWeight: 900,
      letterSpacing: 6,
      textAlign: "right",
      textOpacity: 0.4,
      boxBorderWidth: 12,
      textShadowEnabled: true,
      textShadowColor: "#222222",
      textShadowOffsetX: 8,
      textShadowOffsetY: 9,
      autoFit: true,
      lineHeight: 1.5,
      verticalAlign: "bottom",
      textWrap: false,
      safeMargin: 12,
      truncate: "ellipsis",
    });

    const project = useEditorStore.getState().serializeProject();

    expect(project.textStyle).toEqual(
      expect.objectContaining({
        fontWeight: 900,
        letterSpacing: 6,
        textAlign: "right",
        textOpacity: 0.4,
        boxBorderWidth: 12,
        textShadowEnabled: true,
        textShadowColor: "#222222",
        textShadowOffsetX: 8,
        textShadowOffsetY: 9,
        autoFit: true,
        lineHeight: 1.5,
        verticalAlign: "bottom",
        textWrap: false,
        safeMargin: 12,
        truncate: "ellipsis",
      }),
    );

    useEditorStore.setState({
      fontWeight: 400,
      letterSpacing: 0,
      textAlign: "left",
      textOpacity: 1,
      boxBorderWidth: 4,
      textShadowEnabled: false,
      textShadowColor: "black",
      textShadowOffsetX: 2,
      textShadowOffsetY: 2,
      autoFit: false,
      lineHeight: 1.2,
      verticalAlign: "top",
      textWrap: true,
      safeMargin: 4,
      truncate: "none",
    });

    const result = useEditorStore.getState()._applyProject({ ...project, excel: null });

    expect(result.ok).toBe(true);
    expect(useEditorStore.getState()).toEqual(
      expect.objectContaining({
        fontWeight: 900,
        letterSpacing: 6,
        textAlign: "right",
        textOpacity: 0.4,
        boxBorderWidth: 12,
        textShadowEnabled: true,
        textShadowColor: "#222222",
        textShadowOffsetX: 8,
        textShadowOffsetY: 9,
        autoFit: true,
        lineHeight: 1.5,
        verticalAlign: "bottom",
        textWrap: false,
        safeMargin: 12,
        truncate: "ellipsis",
      }),
    );
  });

  it("loadPreset applies advanced text style fields", () => {
    useEditorStore.setState({
      sidebarMode: "logo",
      fontWeight: 400,
      letterSpacing: 0,
      textAlign: "left",
      textOpacity: 1,
    });

    useEditorStore.getState().loadPreset({
      fontSize: 42,
      fontColor: "#abcdef",
      fontFamily: "Arial Black",
      fontWeight: 900,
      letterSpacing: 3,
      textAlign: "center",
      textOpacity: 0.6,
    });

    expect(useEditorStore.getState()).toEqual(
      expect.objectContaining({
        textFontSize: 42,
        textFontColor: "#abcdef",
        fontFamily: "Arial Black",
        fontWeight: 900,
        letterSpacing: 3,
        textAlign: "center",
        textOpacity: 0.6,
      }),
    );
  });

  it("serialized projects pass the shared document validator", async () => {
    const { validateProjectDocument } = await import("../shared/project-document.js");
    useEditorStore.setState({
      templateRegions: [{ id: 1, label: "TEXT_1", region: { x: 0, y: 0, w: 0.2, h: 0.1 } }],
      excelPath: null,
    });
    const project = useEditorStore.getState().serializeProject();
    expect(project.queue).toBeUndefined();
    expect(validateProjectDocument(project)).toEqual({ valid: true });
    const preset = useEditorStore.getState().serializePreset();
    expect(validateProjectDocument(preset)).toEqual({ valid: true });
  });

  it("persists per-region style in serialized projects", () => {
    useEditorStore.setState({
      templateRegions: [
        {
          id: 1,
          label: "TEXT_1",
          region: { x: 0, y: 0, w: 0.2, h: 0.1 },
          style: { fontSize: 44, fontColor: "#abcdef" },
        },
      ],
    });

    const project = useEditorStore.getState().serializeProject();
    expect(project.templateRegions[0].style).toEqual(
      expect.objectContaining({ fontSize: 44, fontColor: "#abcdef" }),
    );
  });

  it.each([false, true])(
    "replaces old template text while preserving manual operations (Excel: %s)",
    (withExcel) => {
      const oldRegion = { x: 0.1, y: 0.1, w: 0.2, h: 0.2 };
      const manual = { id: "manual", mode: "text", region: oldRegion, text: "Manual" };
      const blur = { id: "blur", mode: "blur", region: oldRegion };
      useEditorStore.setState({
        templateRegions: [{ id: 1, label: "TEXT_1", region: oldRegion }],
        queue: [
          {
            path: "C:\\videos\\sample.mp4",
            filename: "sample.mp4",
            operations: [
              { id: "old", mode: "text", batchRegionId: 1, region: oldRegion, text: "Old" },
              manual,
              blur,
            ],
          },
        ],
        excelRows: withExcel ? [{ ID: "sample", Text: "New" }] : [],
        excelMapping: { idColumn: "ID", columns: { 1: "Text" } },
      });
      const result = useEditorStore.getState().applyPreset({
        type: "beru-preset",
        templateRegions: [{ id: 2, label: "TEXT_2", region: { x: 0.3, y: 0.3, w: 0.2, h: 0.2 } }],
      });
      expect(result.ok).toBe(true);
      const operations = useEditorStore.getState().queue[0].operations;
      expect(operations).toContainEqual(manual);
      expect(operations).toContainEqual(blur);
      expect(operations.some((op) => op.id === "old" || op.text === "Old")).toBe(false);
    },
  );

  it("restores a preset watermark and clears the previous image cache", () => {
    useEditorStore.setState({
      watermark: { enabled: false, text: "Previous", imageDataUrl: "stale" },
    });
    useEditorStore.getState().applyPreset({
      type: "beru-preset",
      templateRegions: [],
      watermark: {
        enabled: true,
        type: "text",
        text: "Saved",
        opacity: 0.5,
        position: "top-left",
      },
    });
    expect(useEditorStore.getState().watermark).toMatchObject({
      enabled: true,
      text: "Saved",
      opacity: 0.5,
      position: "top-left",
      imageDataUrl: "",
    });
  });

  it("does not duplicate recent projects after removing one through IPC", async () => {
    mockApi.removeRecent.mockResolvedValue({
      success: true,
      recent: [{ path: "C:\\projects\\b.beru.json", name: "b.beru.json" }],
    });
    useEditorStore.setState({
      recent: [
        { path: "C:\\projects\\a.beru.json", name: "a.beru.json", exists: true },
        { path: "C:\\projects\\b.beru.json", name: "b.beru.json", exists: true },
      ],
    });

    await useEditorStore.getState().removeRecent("C:\\projects\\a.beru.json");

    expect(useEditorStore.getState().recent).toEqual([
      { path: "C:\\projects\\b.beru.json", name: "b.beru.json", exists: true },
    ]);
  });
});
