import { describe, it, expect, beforeEach, vi } from "vitest";
import { createMockApi, installMockApi, resetEditorState } from "./helpers/store.js";

const mockApi = installMockApi(createMockApi());

const { default: useEditorStore } = await import("../src/stores/useEditorStore.js");

describe("updaterSlice", () => {
  beforeEach(() => resetEditorState(useEditorStore, mockApi));

  it("does not start duplicate downloads while one is already active", async () => {
    window.api = {
      downloadUpdate: vi.fn(async () => ({ ok: true })),
    };

    useEditorStore.setState({
      update: {
        status: "downloading",
        version: "1.6.0",
        percent: 40,
        error: null,
        transferred: 4000,
        total: 10000,
        releaseNotes: "",
        releaseUrl: null,
      },
    });

    const res = await useEditorStore.getState().downloadUpdate();

    expect(res).toEqual({ ok: true, reason: "already-in-progress" });
    expect(window.api.downloadUpdate).not.toHaveBeenCalled();
  });
});
