import { describe, it, expect } from "vitest";
import {
  resolveDetachedOutputPath,
  resolveOutputNames,
  resolveOutputPaths,
} from "../src/utils/output-naming.js";

const item = (path, extra = {}) => ({ path, customOutputName: "", ...extra });

const naming = (overrides = {}) => ({
  templateRegions: [],
  exportFormat: "mp4",
  cellText: () => "",
  displayId: () => "",
  ...overrides,
});

const textRegion = (id, label = "TEXT_1") => ({
  id,
  label,
  region: { x: 0.1, y: 0.1, w: 0.5, h: 0.2 },
});

describe("resolveOutputNames", () => {
  it("falls back to <stem>_beru.<format> without templates or custom names", () => {
    const names = resolveOutputNames(
      [item("C:\\v\\a\\clip.mp4"), item("C:\\v\\b\\other.mov")],
      naming({ exportFormat: "webm" }),
    );
    expect(names).toEqual(["clip_beru.webm", "other_beru.webm"]);
  });

  it("uses customOutputName verbatim when present", () => {
    const names = resolveOutputNames(
      [item("C:\\v\\a.mp4", { customOutputName: "final cut.mp4" })],
      naming(),
    );
    expect(names).toEqual(["final cut.mp4"]);
  });

  it("builds <displayId>_<TEXT_1> names from the naming context", () => {
    const names = resolveOutputNames(
      [item("C:\\v\\a.mp4"), item("C:\\v\\b.mp4")],
      naming({
        templateRegions: [textRegion("r1"), textRegion("r2", "TEXT_2")],
        cellText: (videoIdx, regionId) =>
          regionId === "r1" ? (videoIdx === 0 ? "Uno" : "Dos") : "ignored",
        displayId: (videoIdx) => (videoIdx === 0 ? "promo.mp4" : "spot"),
      }),
    );
    expect(names).toEqual(["promo_Uno.mp4", "spot_Dos.mp4"]);
  });

  it("picks the first region with text when TEXT_1 is empty", () => {
    const names = resolveOutputNames(
      [item("C:\\v\\a.mp4")],
      naming({
        templateRegions: [textRegion("r1"), textRegion("r2", "TEXT_2")],
        cellText: (v, regionId) => (regionId === "r2" ? "Secundario" : ""),
        displayId: () => "id",
      }),
    );
    expect(names).toEqual(["id_Secundario.mp4"]);
  });

  it("falls back to <stem>_beru when the resolved batch name is empty", () => {
    const names = resolveOutputNames(
      [item("C:\\v\\a.mp4")],
      naming({ templateRegions: [textRegion("r1")], cellText: () => "", displayId: () => "" }),
    );
    expect(names).toEqual(["a_beru.mp4"]);
  });

  it("suffixes colliding names with __2, __3 in queue order", () => {
    const names = resolveOutputNames(
      [
        item("C:\\v\\a\\clip.mp4"),
        item("C:\\v\\b\\clip.mp4"),
        item("C:\\v\\c\\clip.mp4"),
        item("C:\\v\\d\\other.mp4"),
      ],
      naming(),
    );
    expect(names).toEqual([
      "clip_beru.mp4",
      "clip_beru__2.mp4",
      "clip_beru__3.mp4",
      "other_beru.mp4",
    ]);
  });

  it("reserves desired suffix names before assigning duplicate names", () => {
    const queue = ["clip.mp4", "clip.mp4", "clip__2.mp4"].map((name, i) =>
      item(`C:\\v\\${i}.mp4`, { customOutputName: name }),
    );
    expect(resolveOutputNames(queue, naming())).toEqual(["clip.mp4", "clip__3.mp4", "clip__2.mp4"]);
    expect(resolveDetachedOutputPath({ ...queue[1] }, queue, "C:\\out", naming())).toBe(
      "C:\\out\\clip__3.mp4",
    );
  });

  it("treats case-only differences as collisions on Windows", () => {
    expect(
      resolveOutputNames([item("C:\\a\\CLIP.mp4"), item("C:\\b\\clip.mp4")], naming()),
    ).toEqual(["CLIP_beru.mp4", "clip_beru__2.mp4"]);
  });
});

describe("resolveOutputPaths", () => {
  it("joins names onto outputDir, defaulting to the item's folder", () => {
    const queue = [item("C:\\v\\a\\clip.mp4"), item("/v/b/other.mp4")];
    expect(resolveOutputPaths(queue, "D:\\exports\\", naming())).toEqual([
      "D:\\exports\\clip_beru.mp4",
      "D:\\exports\\other_beru.mp4",
    ]);
    expect(resolveOutputPaths(queue, "", naming())).toEqual([
      "C:\\v\\a\\clip_beru.mp4",
      "/v/b/other_beru.mp4",
    ]);
  });
});

describe("resolveDetachedOutputPath", () => {
  const queue = [item("C:\\v\\a\\clip.mp4"), item("C:\\v\\b\\clip.mp4")];

  it("gives a clone of a member the member's own rank", () => {
    const clone = { ...queue[1], operations: [] };
    expect(resolveDetachedOutputPath(clone, queue, "C:\\out", naming())).toBe(
      "C:\\out\\clip_beru__2.mp4",
    );
  });

  it("appends a truly detached item after all same-named members", () => {
    const outsider = item("C:\\v\\z\\clip.mp4");
    expect(resolveDetachedOutputPath(outsider, queue, "C:\\out", naming())).toBe(
      "C:\\out\\clip_beru__3.mp4",
    );
  });
});
