import { describe, it, expect } from "vitest";
import { createDelogoRenderSession } from "../src/utils/delogo-render-core.js";
import contract from "../resources/delogo-fixtures.json" with { type: "json" };

describe("Inpaint complex backgrounds", () => {
  it.each(contract.spatial.cases)("$id without changing unrelated pixels", (c) => {
    const { width, height, box } = contract.spatial;
    const clean = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const value =
          45 + ((x + c.phase + Math.floor(y / 2)) % 12 < 3 ? 95 : 0) + (y % 8 < 2 ? 35 : 0);
        const i = (y * width + x) * 4;
        clean.set([value, value, value, 255], i);
      }
    const marked = clean.slice();
    for (let y = box.y; y < box.y + box.h; y++)
      for (let x = box.x; x < box.x + box.w; x++)
        marked.fill(255, (y * width + x) * 4, (y * width + x) * 4 + 4);
    const result = createDelogoRenderSession().compute(
      "inpaint",
      { box, feather: 0 },
      marked,
      width,
      height,
    );
    let error = 0;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h) {
          for (let c = 0; c < 3; c++) error += Math.abs(result.data[i + c] - clean[i + c]);
        } else {
          expect(result.data[i + 3]).toBe(0);
          expect(result.data[i]).toBe(marked[i]);
        }
      }
    expect(error / (box.w * box.h * 3)).toBeLessThan(c.maxMeanError);
  });
});
