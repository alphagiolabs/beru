// Regression: applyPreset with a preset whose templateRegions have fresh IDs
// (created from a different project) silently produced empty text ops for
// EVERY video, because excelMapping.columns was keyed by the OLD region IDs
// and columns[newTr.id] was undefined. The fix re-maps columns from old IDs
// to new IDs by matching regions geometrically before _reapplyExcel runs.

import { describe, it, expect, beforeEach, vi } from "vitest";

globalThis.window = { api: {} };

const { default: useEditorStore } = await import("../src/stores/useEditorStore.js");

function setupState() {
  // Two template regions with OLD numeric IDs 1001 and 1002, both mapped in
  // excelMapping.columns to column names "Nombre" and "Codigo".
  useEditorStore.setState({
    queue: [
      { filename: "video1.mp4", path: "C:\\v\\1.mp4", operations: [], status: "idle" },
      { filename: "video2.mp4", path: "C:\\v\\2.mp4", operations: [], status: "idle" },
    ],
    excelRows: [
      { Nombre: "Alice", Codigo: "A001", Filename: "video1.mp4" },
      { Nombre: "Bob", Codigo: "B002", Filename: "video2.mp4" },
    ],
    excelMapping: {
      idColumn: "Filename",
      columns: { 1001: "Nombre", 1002: "Codigo" },
    },
    templateRegions: [
      { id: 1001, region: { x: 0.1, y: 0.1, w: 0.2, h: 0.1 } },
      { id: 1002, region: { x: 0.5, y: 0.5, w: 0.2, h: 0.1 } },
    ],
    selectedTemplateRegionId: 1001,
  });
}

describe("applyPreset — Excel column re-mapping on region ID change", () => {
  beforeEach(() => {
    setupState();
  });

  it("re-maps excelMapping.columns by geometric region match", () => {
    // Preset with FRESH numeric IDs but SAME regions as the old templateRegions.
    const preset = {
      type: "beru-preset",
      name: "Imported preset",
      templateRegions: [
        { id: 2001, region: { x: 0.1, y: 0.1, w: 0.2, h: 0.1 } },
        { id: 2002, region: { x: 0.5, y: 0.5, w: 0.2, h: 0.1 } },
      ],
      textStyle: {},
      defaults: {},
    };

    const res = useEditorStore.getState().applyPreset(preset);
    expect(res.ok).toBe(true);

    // After applyPreset, the new templateRegions are in place with new IDs.
    const state = useEditorStore.getState();
    expect(state.templateRegions.map((r) => r.id)).toEqual([2001, 2002]);

    // excelMapping.columns must be re-mapped to the new IDs.
    expect(state.excelMapping.columns[2001]).toBe("Nombre");
    expect(state.excelMapping.columns[2002]).toBe("Codigo");

    // And the queue's text ops must have the Excel content, NOT empty strings.
    const ops1 = state.queue[0].operations.filter((o) => o.mode === "text");
    const op1Nombre = ops1.find((o) => o.batchRegionId === 2001);
    const op1Codigo = ops1.find((o) => o.batchRegionId === 2002);
    expect(op1Nombre, "text op for 2001 must exist").toBeTruthy();
    expect(op1Codigo, "text op for 2002 must exist").toBeTruthy();
    expect(op1Nombre.text).toBe("Alice");
    expect(op1Codigo.text).toBe("A001");

    const ops2 = state.queue[1].operations.filter((o) => o.mode === "text");
    const op2Nombre = ops2.find((o) => o.batchRegionId === 2001);
    const op2Codigo = ops2.find((o) => o.batchRegionId === 2002);
    expect(op2Nombre.text).toBe("Bob");
    expect(op2Codigo.text).toBe("B002");
  });

  it("does not re-map when preset region IDs already match existing columns", () => {
    // Preset with the SAME numeric IDs as the current templateRegions.
    const preset = {
      type: "beru-preset",
      name: "Same IDs",
      templateRegions: [
        { id: 1001, region: { x: 0.1, y: 0.1, w: 0.2, h: 0.1 } },
        { id: 1002, region: { x: 0.5, y: 0.5, w: 0.2, h: 0.1 } },
      ],
      textStyle: {},
      defaults: {},
    };

    useEditorStore.getState().applyPreset(preset);
    const state = useEditorStore.getState();
    // Columns untouched (already correct).
    expect(state.excelMapping.columns[1001]).toBe("Nombre");
    expect(state.excelMapping.columns[1002]).toBe("Codigo");
  });
});
