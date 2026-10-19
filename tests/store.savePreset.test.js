import { describe, it, expect, beforeEach, vi } from "vitest";

const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
const getItemSpy = vi.spyOn(Storage.prototype, "getItem");
const removeItemSpy = vi.spyOn(Storage.prototype, "removeItem");

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
    removeItemSpy.mockClear();
    mockApi.savePreset.mockClear();
    mockApi.listPresets.mockClear();
  });

  it("saves through the disk API and refreshes the presets list", async () => {
    const region = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };
    useEditorStore.setState({
      templateRegions: [{ id: 1, label: "TEXT_1", region }],
      textFontSize: 44,
      textFontColor: "#abcdef",
    });
    const res = await useEditorStore.getState().savePreset("Otro");
    expect(res).toEqual(expect.objectContaining({ ok: true }));

    expect(mockApi.savePreset).toHaveBeenCalledTimes(1);
    const [name, jsonStr] = mockApi.savePreset.mock.calls[0];
    expect(name).toBe("Otro");
    const preset = JSON.parse(jsonStr);
    expect(preset).toMatchObject({
      type: "beru-preset",
      excel: null,
      templateRegions: [expect.objectContaining({ id: 1, label: "TEXT_1", region })],
      textStyle: expect.objectContaining({ textFontSize: 44, textFontColor: "#abcdef" }),
    });
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(mockApi.listPresets).toHaveBeenCalledTimes(1);
  });

  it("asks before replacing a preset with the same name", async () => {
    const original = useEditorStore.getState().requestConfirm;
    mockApi.savePreset
      .mockResolvedValueOnce({ success: false, code: "preset_exists", fileName: "Otro.beru.json" })
      .mockResolvedValueOnce({ success: true, fileName: "Otro.beru.json" });
    useEditorStore.setState({ requestConfirm: vi.fn(async () => true) });
    try {
      const res = await useEditorStore.getState().savePreset("Otro");
      expect(res).toEqual(expect.objectContaining({ ok: true }));
      expect(mockApi.savePreset.mock.calls[1][2]).toEqual({ overwrite: true });

      mockApi.savePreset.mockClear();
      mockApi.savePreset.mockResolvedValueOnce({
        success: false,
        code: "preset_exists",
        fileName: "Otro.beru.json",
      });
      useEditorStore.setState({ requestConfirm: vi.fn(async () => false) });
      expect(await useEditorStore.getState().savePreset("Otro")).toEqual({
        ok: false,
        canceled: true,
      });
      expect(mockApi.savePreset).toHaveBeenCalledTimes(1);
    } finally {
      useEditorStore.setState({ requestConfirm: original });
    }
  });

  it("rejects empty names without touching the API", async () => {
    const res = await useEditorStore.getState().savePreset("   ");
    expect(res).toEqual(expect.objectContaining({ ok: false }));
    expect(mockApi.savePreset).not.toHaveBeenCalled();
  });
});

describe("legacy beru-presets migration", () => {
  beforeEach(() => {
    getItemSpy.mockClear();
    removeItemSpy.mockClear();
  });

  it("hydrates from localStorage only when disk presets are empty", () => {
    const legacy = [{ name: "old", filename: "old.beru.json" }];
    getItemSpy.mockReturnValue(JSON.stringify(legacy));
    useEditorStore.setState({ presets: [] });
    useEditorStore.getState().loadPresetsFromStorage();
    expect(useEditorStore.getState().presets).toEqual(legacy);
    expect(removeItemSpy).toHaveBeenCalledWith("beru-presets");
  });

  it("drops the localStorage key when disk presets already exist", () => {
    const disk = [{ name: "disk", filename: "disk.beru.json" }];
    getItemSpy.mockReturnValue(JSON.stringify([{ name: "old", filename: "old.beru.json" }]));
    useEditorStore.setState({ presets: disk });
    useEditorStore.getState().loadPresetsFromStorage();
    expect(useEditorStore.getState().presets).toEqual(disk);
    expect(removeItemSpy).toHaveBeenCalledWith("beru-presets");
  });
});
