import { describe, it, expect } from "vitest";
import { createDelogoRenderSession } from "../src/utils/delogo-render-core.js";

describe("paused delogo frames crossing the Worker boundary", () => {
  it.each(["inpaint", "temporal"])(
    "keeps %s results transferable at a repeated timestamp",
    (method) => {
      const width = 32,
        height = 18,
        box = { x: 8, y: 4, w: 8, h: 6 };
      const frame = new Uint8ClampedArray(width * height * 4);
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const value = x >= 8 && x < 16 && y >= 4 && y < 10 ? 255 : 40;
          frame.set([value, value, value, 255], (y * width + x) * 4);
        }
      const session = createDelogoRenderSession();
      for (let repeat = 0; repeat < 3; repeat++) {
        const result = session.compute(
          method,
          { box, feather: 0, timestamp: 1 },
          frame.slice(),
          width,
          height,
        );
        const delivered = structuredClone(result, { transfer: [result.data.buffer] });
        expect(result.data.byteLength).toBe(0);
        expect(delivered.data.byteLength).toBe(width * height * 4);
        expect(
          Array.from(delivered.data.slice((7 * width + 12) * 4, (7 * width + 12) * 4 + 4)),
        ).toEqual([40, 40, 40, 255]);
      }
    },
  );
});
