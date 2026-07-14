import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  SESSION_PERSIST_KEY,
  buildSessionSnapshot,
  parseSessionSnapshot,
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

  it("round-trips through sessionStorage under the stable key", () => {
    const snap = buildSessionSnapshot({
      queue: [{ path: "C:\\v\\a.mp4", filename: "a.mp4" }],
      outputDir: "C:\\out",
      templateRegions: [],
      selectedTemplateRegionId: null,
      nextRegionLabel: 1,
      excelPath: null,
      excelHeaders: [],
      excelRows: [],
      excelMapping: { idColumn: null, columns: {} },
      excelMatchStatus: {},
      excelRowIndexByFilename: {},
    });
    sessionStorage.setItem(SESSION_PERSIST_KEY, JSON.stringify(snap));
    const raw = sessionStorage.getItem(SESSION_PERSIST_KEY);
    const restored = parseSessionSnapshot(JSON.parse(raw));
    expect(restored.outputDir).toBe("C:\\out");
    expect(restored.queue[0].path).toBe("C:\\v\\a.mp4");
  });

  it("skips sessionStorage setItem when snapshot JSON is unchanged", () => {
    const state = {
      queue: [{ path: "C:\\v\\a.mp4", filename: "a.mp4" }],
      outputDir: "C:\\out",
    };
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    writeSessionSnapshotToStorage(state);
    writeSessionSnapshotToStorage(state);
    writeSessionSnapshotToStorage(state);
    expect(setItem).toHaveBeenCalledTimes(1);
    setItem.mockRestore();
  });

  it("persists watermark settings without imageDataUrl", () => {
    const snap = buildSessionSnapshot({
      queue: [{ path: "C:\\v\\a.mp4", filename: "a.mp4" }],
      outputDir: "C:\\out",
      watermark: {
        enabled: true,
        type: "image",
        text: "",
        imagePath: "C:\\wm\\logo.png",
        imageDataUrl: "data:image/png;base64,AAAA",
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
    expect(snap.watermark.imageDataUrl).toBeUndefined();
    const restored = parseSessionSnapshot(snap);
    expect(restored.watermark).toMatchObject({
      enabled: true,
      imagePath: "C:\\wm\\logo.png",
      imageDataUrl: "",
    });
  });
});
