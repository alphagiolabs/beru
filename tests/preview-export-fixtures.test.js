import { spawnSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";
import { readContract, previewExportInputs } from "./helpers/preview-export-inputs.js";
import { queueCapacityInput } from "../src/utils/batch-capacity.js";
import { motionDescriptor, estimateMotion } from "../src/utils/delogo-motion.js";
import { outputLayout } from "../src/utils/output-geometry.js";
import { frameRectAfterCrops } from "../src/utils/crop-output.js";

const classify = readContract("job-classify");
const delogo = readContract("delogo");
const geometry = readContract("output-geometry");
const crop = readContract("crop-output");
const watermark = readContract("watermark-position");
let python;

beforeAll(() => {
  const result = spawnSync(
    process.env.BERU_PYTHON || "python",
    ["python/test_preview_export_fixtures.py", "--json"],
    {
      input: JSON.stringify(previewExportInputs()),
      encoding: "utf8",
      timeout: 20000,
    },
  );
  expect(result.status, result.stderr || result.error?.message).toBe(0);
  python = JSON.parse(result.stdout);
});

describe("output geometry boundary cases", () => {
  it.each(geometry.cases.map((c, index) => [c.id, c, index]))("%s", (_id, c, index) => {
    expect(outputLayout(c.frame, c.transform)).toEqual(c.expected);
    expect(python.geometry[index]).toEqual(c.expected);
  });
});

describe("iterative crop output", () => {
  it.each(crop.cases.map((c, index) => [c.id, c, index]))("%s", (_id, c, index) => {
    expect(frameRectAfterCrops(c.operations, crop.dims)).toEqual(c.expected);
    expect(python.crop[index]).toEqual(c.expected);
  });
});

describe("watermark export positions (preview uses the same fixture)", () => {
  it.each(watermark.cases.map((c, index) => [c.id, c, index]))("%s", (_id, c, index) => {
    expect(python.watermark[index].text).toEqual(c.expected);
    expect(python.watermark[index].image).toEqual(c.expected);
  });
});

describe("video encode classification across the Job boundary", () => {
  it.each(classify.cases.map((c, index) => [c.id, c, index]))("%s", (_id, c, index) => {
    expect(
      queueCapacityInput([{ ...classify.base, ...c.item }], [], c.watermark).hasVideoFilters,
    ).toBe(c.expected);
    expect(python.classify[index]).toBe(c.expected);
  });
});

describe("temporal motion contract", () => {
  const { width, height } = delogo.motion;
  let seed = 24;
  const noise = Uint8ClampedArray.from({ length: (width + 48) * height * 3 }, () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return 20 + (seed % 210);
  });
  it.each(delogo.motion.cases.map((c, index) => [c.id, c, index]))("%s", (_id, c, index) => {
    const box = c.box || delogo.motion.box;
    const frame = (shift) => {
      const data = new Uint8ClampedArray(width * height * 4);
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const offset = (y * width + x) * 4;
          for (let channel = 0; channel < 3; channel++)
            data[offset + channel] =
              c.pattern === "noise"
                ? noise[(y * (width + 48) + x + shift) * 3 + channel]
                : c.pattern === "periodic"
                  ? ((x + shift + c.period) % c.period) * 20
                  : shift;
          data[offset + 3] = 255;
          if (x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h)
            data.fill(255, offset, offset + 3);
        }
      return motionDescriptor(data, width, height);
    };
    const actual = estimateMotion(frame(c.current), frame(c.donor), width, height, box);
    for (const motion of [actual, python.motion[index]]) {
      if (c.expected === null) expect(motion).toBeNull();
      else {
        expect({ dx: motion.dx, dy: motion.dy }).toEqual({ dx: c.expected.dx, dy: c.expected.dy });
        expect(motion.error).toBeCloseTo(c.expected.error, 4);
      }
    }
  });
});

describe("spatial inpaint quality in Processor (preview uses the same fixture)", () => {
  it.each(delogo.spatial.cases.map((c, index) => [c.id, c, index]))("%s", (_id, c, index) => {
    expect(python.spatial[index]).toBeLessThan(c.maxMeanError);
  });
});
