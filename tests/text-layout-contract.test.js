/**
 * Versioned text-layout contract (resources/text-layout-fixtures.json).
 * JS and Python must agree on bounds inset + wrap heuristic.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "child_process";
import contract from "../resources/text-layout-fixtures.json" with { type: "json" };
import { textBoxPad, textLayoutBounds, wrapTextToWidth } from "../src/utils/text-layout.js";

const PY = process.platform === "win32" ? "python" : "python3";
const PY_CODE_PREFIX = "import sys; sys.path.insert(0, 'python'); ";

const hasPython = (() => {
  try {
    return spawnSync(PY, ["--version"], { encoding: "utf8" }).status === 0;
  } catch {
    return false;
  }
})();

const describeIfPython = hasPython ? describe : describe.skip;

function jsBoundsForCase(c) {
  const boxPad = textBoxPad(c.op);
  return { box_pad: boxPad, bounds: textLayoutBounds(c.region, c.safe_margin, boxPad) };
}

describe("text layout contract (JSON)", () => {
  it("is versioned and non-empty", () => {
    expect(contract.version).toBe(1);
    expect(contract.bounds_cases.length).toBeGreaterThan(0);
    expect(contract.wrap_cases.length).toBeGreaterThan(0);
  });
});

describe("text layout contract (JS)", () => {
  it.each(contract.bounds_cases.map((c) => [c.id, c]))(
    "bounds case %s matches fixture",
    (_id, c) => {
      expect(jsBoundsForCase(c)).toEqual(c.expected);
    },
  );

  it.each(contract.wrap_cases.map((c) => [c.id, c]))("wrap case %s matches fixture", (_id, c) => {
    expect(wrapTextToWidth(c.text, c.max_width_px, c.font_size)).toBe(c.expected.wrapped);
  });
});

describeIfPython("text layout contract (Python parity)", () => {
  it("bounds + wrap match JS and fixtures", () => {
    const code = `
import json
from text_layout_helpers import _text_box_pad, _text_layout_bounds, _wrap_text_to_width

with open("resources/text-layout-fixtures.json", encoding="utf-8") as f:
    contract = json.load(f)

out = {"bounds": [], "wrap": []}
for c in contract["bounds_cases"]:
    pad = _text_box_pad(c["op"])
    out["bounds"].append({
        "id": c["id"],
        "box_pad": pad,
        "bounds": _text_layout_bounds(c["region"], c["safe_margin"], pad),
    })
for c in contract["wrap_cases"]:
    out["wrap"].append({
        "id": c["id"],
        "wrapped": _wrap_text_to_width(c["text"], c["max_width_px"], c["font_size"]),
    })
print(json.dumps(out))
`;
    const r = spawnSync(PY, ["-c", PY_CODE_PREFIX + code], { encoding: "utf8" });
    if (r.status !== 0) {
      console.error("STDOUT:", r.stdout);
      console.error("STDERR:", r.stderr);
    }
    expect(r.status).toBe(0);
    const py = JSON.parse(r.stdout.trim());

    for (const c of contract.bounds_cases) {
      const row = py.bounds.find((b) => b.id === c.id);
      expect(row, c.id).toBeTruthy();
      expect({ box_pad: row.box_pad, bounds: row.bounds }).toEqual(c.expected);
      expect(jsBoundsForCase(c)).toEqual(c.expected);
    }

    for (const c of contract.wrap_cases) {
      const row = py.wrap.find((w) => w.id === c.id);
      expect(row, c.id).toBeTruthy();
      expect(row.wrapped).toBe(c.expected.wrapped);
      expect(wrapTextToWidth(c.text, c.max_width_px, c.font_size)).toBe(c.expected.wrapped);
    }
  });
});
