import { describe, expect, it } from "vitest";
import { createDelogoRenderSession } from "../src/utils/delogo-render-core.js";

const width = 128,
  height = 80;
const box = { x: 52, y: 30, w: 8, h: 12 };

function fixture() {
  let seed = 24;
  const texture = Uint8ClampedArray.from({ length: (width + 80) * height * 3 }, () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return 20 + (seed % 210);
  });
  return (index, cut = false) => {
    const clean = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const dst = (y * width + x) * 4,
          src = (y * (width + 80) + x + index * 3) * 3;
        for (let c = 0; c < 3; c++)
          clean[dst + c] = cut ? 255 - texture[src + c] : texture[src + c];
        clean[dst + 3] = 255;
      }
    const marked = clean.slice();
    for (let y = box.y; y < box.y + box.h; y++)
      for (let x = box.x; x < box.x + box.w; x++)
        marked.fill(255, (y * width + x) * 4, (y * width + x) * 4 + 3);
    return { clean, marked };
  };
}

function render(session, sample, index, extra = {}) {
  return session.compute(
    "temporal",
    { box, radius: 5, feather: 0, timestamp: index / 25, ...extra },
    sample.marked,
    width,
    height,
  ).data;
}

describe("Temporal quick preview", () => {
  it("uses a single precisely aligned donor at the start of a clip", () => {
    const frame = fixture(),
      session = createDelogoRenderSession();
    render(session, frame(0), 0);
    const sample = frame(1),
      actual = render(session, sample, 1);
    for (let y = box.y; y < box.y + box.h; y++)
      for (let x = box.x + box.w - 1; x < box.x + box.w; x++)
        for (let c = 0; c < 3; c++) {
          const offset = (y * width + x) * 4 + c;
          expect(actual[offset]).toBe(sample.clean[offset]);
        }
  });
  it("recovers translated texture from clean donor pixels and masks the surrounding video", () => {
    const frame = fixture(),
      session = createDelogoRenderSession();
    let actual, sample;
    for (let i = 0; i <= 8; i++) {
      sample = frame(i);
      actual = render(session, sample, i);
    }
    let error = 0;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * 4;
        const inside = x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h;
        if (inside)
          for (let c = 0; c < 3; c++)
            error += Math.abs(actual[offset + c] - sample.clean[offset + c]);
        else expect(actual[offset + 3]).toBe(0);
      }
    expect(error / (box.w * box.h * 3)).toBeLessThan(4);
  });

  it("discards references across cuts, backward seeks and parameter changes", () => {
    const frame = fixture(),
      session = createDelogoRenderSession();
    for (let i = 0; i < 8; i++) render(session, frame(i), i);
    const cut = frame(8, true);
    const actual = render(session, cut, 8);
    expect(actual).toEqual(render(createDelogoRenderSession(), cut, 8));
    expect(render(session, cut, 8)).toEqual(actual);
    expect(render(session, frame(0), 0)).toEqual(render(createDelogoRenderSession(), frame(0), 0));
    for (let i = 1; i < 8; i++) render(session, frame(i), i);
    expect(render(session, frame(8), 8, { radius: 1 })).toEqual(
      render(createDelogoRenderSession(), frame(8), 8, { radius: 1 }),
    );
  });
});
