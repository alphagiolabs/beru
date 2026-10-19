import { describe, it, expect, beforeEach, vi } from "vitest";

const setItemSpy = vi.spyOn(Storage.prototype, "setItem");

const mockApi = {
  deletePreset: vi.fn(async (filename) => ({ success: true, fileName: filename })),
  listPresets: vi.fn(async () => ({
    success: true,
    presets: [{ name: "Otro", filename: "otro.beru.json", data: { type: "beru-preset" } }],
    userDir: "/tmp/presets",
  })),
};

globalThis.window = { api: mockApi };

const { default: useEditorStore } = await import("../src/stores/useEditorStore.js");

describe("useEditorStore.deletePreset", () => {
  beforeEach(() => {
    setItemSpy.mockClear();
    mockApi.deletePreset.mockClear();
    mockApi.listPresets.mockClear();
    useEditorStore.setState({
      presets: [{ name: "Mío", filename: "mio.beru.json", data: { type: "beru-preset" } }],
    });
  });

  it("deletes through the disk API, refreshes the list and leaves localStorage alone", async () => {
    const res = await useEditorStore.getState().deletePreset({
      name: "Mío",
      filename: "mio.beru.json",
    });
    expect(res).toEqual(expect.objectContaining({ ok: true }));
    expect(mockApi.deletePreset).toHaveBeenCalledTimes(1);
    expect(mockApi.deletePreset.mock.calls[0][0]).toBe("mio.beru.json");
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(mockApi.listPresets).toHaveBeenCalledTimes(1);
    expect(useEditorStore.getState().presets).toHaveLength(1);
    expect(useEditorStore.getState().presets[0].filename).toBe("otro.beru.json");
  });

  it("rejects presets missing a filename", async () => {
    const res = await useEditorStore.getState().deletePreset({ name: "X" });
    expect(res.ok).toBe(false);
    expect(mockApi.deletePreset).not.toHaveBeenCalled();
  });

  it("propagates API failures", async () => {
    mockApi.deletePreset.mockResolvedValueOnce({ success: false, error: "boom" });
    const res = await useEditorStore.getState().deletePreset({
      name: "Mío",
      filename: "mio.beru.json",
    });
    expect(res).toEqual({ ok: false, error: "boom" });
  });
});
