import { describe, it, expect } from "vitest";
import { spawnSync } from "child_process";
import contract from "../resources/text-layout-fixtures.json" with { type: "json" };
import {
  fitFontSize,
  layoutExportText,
  textBoxPad,
  textLayoutBounds,
  truncateText,
  wrapTextToWidth,
} from "../src/utils/text-layout.js";

const PY = "python";
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
    expect(contract.fit_cases.length).toBeGreaterThan(0);
    expect(contract.truncate_cases.length).toBeGreaterThan(0);
    expect(contract.layout_cases.length).toBeGreaterThan(0);
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

  it.each(contract.fit_cases.map((c) => [c.id, c]))("fit case %s matches fixture", (_id, c) => {
    expect(fitFontSize(c.text, c.region_w, c.region_h, c.font_size, c.line_height, c.wrap)).toBe(
      c.expected.font_size,
    );
  });

  it.each(contract.truncate_cases.map((c) => [c.id, c]))(
    "truncate case %s matches fixture",
    (_id, c) => {
      expect(truncateText(c.text, c.max_width_px, c.font_size, c.mode)).toBe(c.expected.truncated);
    },
  );

  it.each(contract.layout_cases.map((c) => [c.id, c]))(
    "layout case %s matches fixture",
    (_id, c) => {
      expect(
        layoutExportText({
          text: c.text,
          regionW: c.region_w,
          regionH: c.region_h,
          fontSize: c.font_size,
          lineHeight: c.line_height,
          textWrap: c.text_wrap,
          autoFit: c.auto_fit,
          truncate: c.truncate,
        }),
      ).toEqual({
        fontSize: c.expected.font_size,
        displayText: c.expected.display_text,
      });
    },
  );
});

describeIfPython("text layout contract (Python parity)", () => {
  it("bounds + wrap match JS and fixtures", () => {
    const code = `
import json
from text_layout_helpers import (
    _fit_font_size,
    _layout_export_text,
    _text_box_pad,
    _text_layout_bounds,
    _truncate_text,
    _wrap_text_to_width,
)

with open("resources/text-layout-fixtures.json", encoding="utf-8") as f:
    contract = json.load(f)

out = {"bounds": [], "wrap": [], "fit": [], "truncate": [], "layout": []}
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
for c in contract["fit_cases"]:
    out["fit"].append({
        "id": c["id"],
        "font_size": _fit_font_size(c["text"], c["region_w"], c["region_h"], c["font_size"], c["line_height"], c["wrap"]),
    })
for c in contract["truncate_cases"]:
    out["truncate"].append({
        "id": c["id"],
        "truncated": _truncate_text(c["text"], c["max_width_px"], c["font_size"], c["mode"]),
    })
for c in contract["layout_cases"]:
    laid = _layout_export_text(
        c["text"],
        c["region_w"],
        c["region_h"],
        font_size=c["font_size"],
        line_height=c["line_height"],
        text_wrap=c["text_wrap"],
        auto_fit=c["auto_fit"],
        truncate=c["truncate"],
    )
    out["layout"].append({"id": c["id"], **laid})
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

    for (const c of contract.fit_cases) {
      const row = py.fit.find((f) => f.id === c.id);
      expect(row, c.id).toBeTruthy();
      expect(row.font_size).toBe(c.expected.font_size);
    }

    for (const c of contract.truncate_cases) {
      const row = py.truncate.find((t) => t.id === c.id);
      expect(row, c.id).toBeTruthy();
      expect(row.truncated).toBe(c.expected.truncated);
    }

    for (const c of contract.layout_cases) {
      const row = py.layout.find((l) => l.id === c.id);
      expect(row, c.id).toBeTruthy();
      expect({ font_size: row.font_size, display_text: row.display_text }).toEqual(c.expected);
    }
  });
});
