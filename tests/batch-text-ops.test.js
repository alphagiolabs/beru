import { describe, it, expect } from "vitest";
import {
  applyBatchTextOperations,
  buildBatchTextOperationsForPreview,
} from "../src/utils/batch-text-ops.js";
import { TEXT_STYLE_DEFAULTS } from "../src/utils/text-style.js";

const region = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };
const templates = [{ id: "r1", label: "TEXT_1", region, style: { fontSize: 40 } }];

describe("applyBatchTextOperations", () => {
  it("creates a text operation when resolveText returns content", () => {
    const ops = applyBatchTextOperations(
      { operations: [] },
      templates,
      TEXT_STYLE_DEFAULTS,
      () => "Hola",
      0,
    );
    expect(ops).toHaveLength(1);
    expect(ops[0].mode).toBe("text");
    expect(ops[0].text).toBe("Hola");
    expect(ops[0].batchRegionId).toBe("r1");
    expect(ops[0].fontSize).toBe(40);
  });

  it("removes the matching text operation when resolveText is empty", () => {
    const ops = applyBatchTextOperations(
      {
        operations: [
          { id: "t1", mode: "text", batchRegionId: "r1", region, text: "old" },
          { id: "b1", mode: "blur", region: { x: 0, y: 0, w: 0.2, h: 0.2 } },
        ],
      },
      templates,
      TEXT_STYLE_DEFAULTS,
      () => "",
      0,
    );
    expect(ops).toHaveLength(1);
    expect(ops[0].mode).toBe("blur");
  });

  it("returns cloned operations when there are no template regions", () => {
    const original = { id: "b1", mode: "blur", region: { x: 0, y: 0, w: 0.2, h: 0.2 } };
    const ops = applyBatchTextOperations(
      { operations: [original] },
      [],
      TEXT_STYLE_DEFAULTS,
      () => "ignored",
      0,
    );
    expect(ops).toHaveLength(1);
    expect(ops[0]).toEqual(original);
    expect(ops[0]).not.toBe(original);
  });
});

describe("buildBatchTextOperationsForPreview", () => {
  it("keeps the region label when the excel cell is empty", () => {
    const state = {
      queue: [{ operations: [] }],
      templateRegions: templates,
      getBatchPreviewText: () => "TEXT_1",
    };
    const ops = buildBatchTextOperationsForPreview(state, 0);
    expect(ops).toHaveLength(1);
    expect(ops[0].text).toBe("TEXT_1");
  });
});
