// Tests for the disk-backed deletePreset store action.
// deletePreset must call window.api.deletePreset (IPC), refuse bundled presets,
// and refresh the presets list from disk afterwards.

import { describe, it, expect, beforeEach, vi } from "vitest";

const setItemSpy = vi.spyOn(Storage.prototype, "setItem");

const mockApi = {
  deletePreset: vi.fn(async (filename) => ({ success: true, fileName: filename })),
  listPresets: vi.fn(async () => ({
    success: true,
    presets: [
      { name: "Otro", filename: "otro.beru.json", source: "user", data: { type: "beru-preset" } },
    ],
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
      presets: [
        { name: "Mío", filename: "mio.beru.json", source: "user", data: { type: "beru-preset" } },
        {
          name: "Subtítulo",
          filename: "subtitle.beru.json",
          source: "bundled",
          data: { type: "beru-preset" },
        },
      ],
    });
  });

  it("is async and calls window.api.deletePreset with the filename", async () => {
    const result = useEditorStore.getState().deletePreset({
      name: "Mío",
      filename: "mio.beru.json",
      source: "user",
    });
    expect(result).toBeDefined();
    expect(typeof result.then).toBe("function");

    const res = await result;
    expect(res).toEqual(expect.objectContaining({ ok: true }));
    expect(mockApi.deletePreset).toHaveBeenCalledTimes(1);
    expect(mockApi.deletePreset.mock.calls[0][0]).toBe("mio.beru.json");
  });

  it("refreshes the presets list from disk after deleting", async () => {
    await useEditorStore.getState().deletePreset({
      name: "Mío",
      filename: "mio.beru.json",
      source: "user",
    });
    expect(mockApi.listPresets).toHaveBeenCalledTimes(1);
    // The refreshed list (from the mock) replaces the in-memory list.
    expect(useEditorStore.getState().presets).toHaveLength(1);
    expect(useEditorStore.getState().presets[0].filename).toBe("otro.beru.json");
  });

  it("refuses to delete bundled presets without calling the API", async () => {
    const res = await useEditorStore.getState().deletePreset({
      name: "Subtítulo",
      filename: "subtitle.beru.json",
      source: "bundled",
    });
    expect(res.ok).toBe(false);
    expect(mockApi.deletePreset).not.toHaveBeenCalled();
  });

  it("rejects presets missing a filename", async () => {
    const res = await useEditorStore.getState().deletePreset({ name: "X", source: "user" });
    expect(res.ok).toBe(false);
    expect(mockApi.deletePreset).not.toHaveBeenCalled();
  });

  it("does not write to localStorage (disk-backed, not the old sync path)", async () => {
    await useEditorStore.getState().deletePreset({
      name: "Mío",
      filename: "mio.beru.json",
      source: "user",
    });
    expect(setItemSpy).not.toHaveBeenCalled();
  });

  it("propagates API failures", async () => {
    mockApi.deletePreset.mockResolvedValueOnce({ success: false, error: "boom" });
    const res = await useEditorStore.getState().deletePreset({
      name: "Mío",
      filename: "mio.beru.json",
      source: "user",
    });
    expect(res).toEqual({ ok: false, error: "boom" });
  });
});
