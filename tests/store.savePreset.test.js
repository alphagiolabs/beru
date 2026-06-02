// Regression test for the "PresetManager savePreset" bug:
// `useEditorStore.savePreset` must be the async, disk-backed version.
// A duplicate sync/localStorage `savePreset` in the store would win because
// of object-literal key shadowing and silently bypass the IPC + UI refresh.

import { describe, it, expect, beforeEach, vi } from "vitest";

const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
const getItemSpy = vi.spyOn(Storage.prototype, "getItem");

const mockApi = {
  savePreset: vi.fn(async (_name, _json) => ({ success: true, fileName: "test.beru.json" })),
  listPresets: vi.fn(async () => ({ success: true, presets: [], userDir: "/tmp/presets" })),
};

globalThis.window = { api: mockApi };

const { default: useEditorStore } = await import("../src/stores/useEditorStore.js");

describe("useEditorStore.savePreset", () => {
  beforeEach(() => {
    setItemSpy.mockClear();
    getItemSpy.mockClear();
    mockApi.savePreset.mockClear();
    mockApi.listPresets.mockClear();
  });

  it("returns a Promise (async, disk-backed) and not a sync localStorage write", async () => {
    const result = useEditorStore.getState().savePreset("Mi preset");
    expect(result).toBeDefined();
    expect(typeof result.then).toBe("function");

    const res = await result;
    expect(res).toEqual(expect.objectContaining({ ok: true }));

    expect(mockApi.savePreset).toHaveBeenCalledTimes(1);
    expect(setItemSpy).not.toHaveBeenCalled();
  });

  it("calls window.api.savePreset and refreshes the presets list", async () => {
    await useEditorStore.getState().savePreset("Otro");
    expect(mockApi.savePreset).toHaveBeenCalledTimes(1);
    const [name, jsonStr] = mockApi.savePreset.mock.calls[0];
    expect(name).toBe("Otro");
    expect(() => JSON.parse(jsonStr)).not.toThrow();
    expect(mockApi.listPresets).toHaveBeenCalledTimes(1);
  });

  it("rejects empty names without touching the API", async () => {
    const res = await useEditorStore.getState().savePreset("   ");
    expect(res).toEqual(expect.objectContaining({ ok: false }));
    expect(mockApi.savePreset).not.toHaveBeenCalled();
  });
});
