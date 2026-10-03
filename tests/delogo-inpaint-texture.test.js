import { describe, it, expect } from "vitest";
import { createDelogoRenderSession } from "../src/utils/delogo-render-core.js";

describe("Inpaint complex backgrounds", () => {
  it.each([0, 1, 5])("continues texture at phase %s without changing unrelated pixels", (phase) => {
    const width = 192,
      height = 112;
    const box = { x: 76, y: 40, w: 18, h: 24 };
    const clean = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const value =
          45 + ((x + phase + Math.floor(y / 2)) % 12 < 3 ? 95 : 0) + (y % 8 < 2 ? 35 : 0);
        const i = (y * width + x) * 4;
        clean.set([value, value, value, 255], i);
      }
    const marked = clean.slice();
    for (let y = 40; y < 64; y++)
      for (let x = 76; x < 94; x++) marked.fill(255, (y * width + x) * 4, (y * width + x) * 4 + 4);
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
        if (x >= 76 && x < 94 && y >= 40 && y < 64) {
          for (let c = 0; c < 3; c++) error += Math.abs(result.data[i + c] - clean[i + c]);
        } else {
          expect(result.data[i + 3]).toBe(0);
          expect(result.data[i]).toBe(marked[i]);
        }
      }
    expect(error / (18 * 24 * 3)).toBeLessThan(5);
  });
});
