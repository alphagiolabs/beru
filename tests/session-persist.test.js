import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildExportJob } from "../src/utils/export-pipeline.js";
import {
  SESSION_PERSIST_KEY,
  SESSION_PERSIST_KEYS,
  buildSessionSnapshot,
  hasPersistedFieldChanged,
  parseSessionSnapshot,
  readSessionSnapshotFromStorage,
  writeSessionSnapshotToStorage,
  resetSessionWriteCache,
} from "../src/utils/session-persist.js";

describe("session-persist", () => {
  beforeEach(() => {
    sessionStorage.clear();
    resetSessionWriteCache();
  });

  afterEach(() => {
    sessionStorage.clear();
    resetSessionWriteCache();
  });

  it("builds a snapshot with queue, outputDir, and batch/excel context", () => {
    const snapshot = buildSessionSnapshot({
      queue: [
        {
          path: "C:\\v\\a.mp4",
          src: "beru://local/a",
          filename: "a.mp4",
          width: 1920,
          height: 1080,
          duration: 12,
          operations: [{ mode: "text", text: "hi" }],
          customOutputName: "out",
          status: "processing",
          thumbnail: "data:huge",
        },
      ],
      outputDir: "C:\\out",
      templateRegions: [{ id: 1, label: "TEXT_1", region: { x: 0, y: 0, w: 1, h: 1 } }],
      selectedTemplateRegionId: 1,
      nextRegionLabel: 2,
      excelPath: "C:\\data.xlsx",
      excelHeaders: ["id", "text"],
      excelRows: [{ id: "a", text: "hola" }],
      excelMapping: { idColumn: "id", columns: { 1: "text" } },
      excelMatchStatus: { 0: "matched" },
      excelRowIndexByFilename: { a: 0 },
    });

    expect(snapshot.version).toBe(1);
    expect(snapshot.outputDir).toBe("C:\\out");
    expect(snapshot.queue[0]).toMatchObject({
      path: "C:\\v\\a.mp4",
      operations: [{ mode: "text", text: "hi" }],
    });
    expect(snapshot.queue[0].thumbnail).toBeUndefined();
    expect(snapshot.queue[0].status).toBeUndefined();
    expect(snapshot.templateRegions).toHaveLength(1);
    expect(snapshot.excelPath).toBe("C:\\data.xlsx");
    expect(snapshot.excelRows).toHaveLength(1);
  });

  it("parses legacy queue-only arrays", () => {
    const restored = parseSessionSnapshot([
      { path: "C:\\v\\a.mp4", filename: "a.mp4", width: 100, height: 50 },
    ]);
    expect(restored.queue).toHaveLength(1);
    expect(restored.queue[0].status).toBe("idle");
    expect(restored.outputDir).toBeNull();
    expect(restored.templateRegions).toEqual([]);
  });

  it("preserves source media metadata in an export after session restoration", () => {
    const snapshot = buildSessionSnapshot({
      queue: [
        {
          path: "C:\\v\\hdr.mp4",
          filename: "hdr.mp4",
          width: 1920,
          height: 1080,
          sourceWidth: 1920,
          sourceHeight: 1080,
          duration: 10,
          trimStart: 1,
          trimEnd: 9,
          operations: [],
          pixFmt: "yuv420p10le",
          frameRate: 60,
          videoCodec: "hevc",
          audioCodec: "aac",
          audioChannels: 6,
        },
      ],
    });
    const restored = parseSessionSnapshot(JSON.parse(JSON.stringify(snapshot)));
    const job = buildExportJob(restored.queue[0], 0, { outputPath: "C:\\out\\hdr.mp4" });
    expect(job).toMatchObject({
      source_width: 1920,
      source_height: 1080,
      video_duration: 10,
      trim_start: 1,
      trim_end: 9,
      pix_fmt: "yuv420p10le",
      frame_rate: 60,
      video_codec: "hevc",
      audio_codec: "aac",
      audio_channels: 6,
      video_info_probed: true,
    });
  });

  it("parses v1 snapshots and resets runtime queue fields", () => {
    const restored = parseSessionSnapshot({
      version: 1,
      queue: [{ path: "C:\\v\\a.mp4", filename: "a.mp4", width: 10, height: 10 }],
      outputDir: "C:\\out",
      templateRegions: [{ id: 9, label: "TEXT_1" }],
      selectedTemplateRegionId: 9,
      nextRegionLabel: 3,
      excelPath: "C:\\x.xlsx",
      excelHeaders: ["a"],
      excelRows: [{ a: 1 }],
      excelMapping: { idColumn: "a", columns: {} },
      excelMatchStatus: {},
      excelRowIndexByFilename: {},
    });
    expect(restored.outputDir).toBe("C:\\out");
    expect(restored.templateRegions[0].id).toBe(9);
    expect(restored.queue[0]).toMatchObject({
      status: "idle",
      progress: 0,
      error: null,
      thumbnail: null,
    });
  });

  it("writes and restores under the stable key without rewriting an unchanged snapshot", () => {
    const state = {
      queue: [{ path: "C:\\v\\a.mp4", filename: "a.mp4" }],
      outputDir: "C:\\out",
    };
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    writeSessionSnapshotToStorage(state);
    writeSessionSnapshotToStorage(state);
    writeSessionSnapshotToStorage(state);
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(setItem.mock.calls[0][0]).toBe("beru-queue-session");
    expect(JSON.parse(setItem.mock.calls[0][1])).toMatchObject({
      outputDir: "C:\\out",
      queue: [{ path: "C:\\v\\a.mp4" }],
    });
    const restored = readSessionSnapshotFromStorage();
    expect(restored.outputDir).toBe("C:\\out");
    expect(restored.queue[0].path).toBe("C:\\v\\a.mp4");
    setItem.mockRestore();
  });

  it("logs once when sessionStorage setItem throws", () => {
    const state = { queue: [{ path: "C:\\v\\a.mp4", filename: "a.mp4" }] };
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota exceeded", "QuotaExceededError");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    writeSessionSnapshotToStorage(state);
    writeSessionSnapshotToStorage({ ...state, outputDir: "C:\\out2" });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("Session persist");
    warn.mockRestore();
    setItem.mockRestore();
  });

  it("removes a restored queue cleared before the first write", () => {
    sessionStorage.setItem(
      SESSION_PERSIST_KEY,
      JSON.stringify({
        queue: [{ path: "C:\\v\\a.mp4", operations: [{ mode: "text", text: "Old" }] }],
      }),
    );
    const restored = readSessionSnapshotFromStorage();
    expect(restored.queue).toHaveLength(1);
    writeSessionSnapshotToStorage({ ...restored, queue: [] });
    expect(readSessionSnapshotFromStorage()).toBeNull();
    expect(sessionStorage.getItem(SESSION_PERSIST_KEY)).toBeNull();
  });

  it("persists watermark settings without imageV", () => {
    const snap = buildSessionSnapshot({
      queue: [{ path: "C:\\v\\a.mp4", filename: "a.mp4" }],
      outputDir: "C:\\out",
      watermark: {
        enabled: true,
        type: "image",
        text: "",
        imagePath: "C:\\wm\\logo.png",
        imageV: "1700000000000-4",
        opacity: 0.4,
        scale: 1.2,
        position: "top-left",
        fontSize: 20,
        fontColor: "#fff",
        fontFamily: "Arial",
      },
    });
    expect(snap.watermark).toMatchObject({
      enabled: true,
      type: "image",
      imagePath: "C:\\wm\\logo.png",
      opacity: 0.4,
    });
    expect(snap.watermark.imageV).toBeUndefined();
    const restored = parseSessionSnapshot(snap);
    expect(restored.watermark).toMatchObject({
      enabled: true,
      imagePath: "C:\\wm\\logo.png",
      imageV: "",
    });
  });

  it("watches every field the snapshot writes (trigger covers snapshot)", () => {
    const snapshot = buildSessionSnapshot({ queue: [{ path: "C:\\v\\a.mp4" }] });
    for (const key of Object.keys(snapshot)) {
      if (key === "version") continue;
      expect(SESSION_PERSIST_KEYS).toContain(key);
      expect(hasPersistedFieldChanged({ [key]: {} }, {})).toBe(true);
    }
    expect(hasPersistedFieldChanged({ sidebarMode: "a" }, { sidebarMode: "b" })).toBe(false);
  });
});
