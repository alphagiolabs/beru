import { describe, expect, it } from "vitest";
import { spawnSync } from "child_process";
import fixtures from "../resources/datetime-stamp-fixtures.json" with { type: "json" };
import {
  DVR_STAMP_REGION,
  dvrStampFontSize,
  clockStartFromDate,
  clockToJobPayload,
  formatClockBlocks,
  parseClockStart,
  splitClockRegion,
} from "../src/utils/datetime-stamp.js";
import {
  createOperation,
  filterOperationsForExport,
  operationToJobPayload,
} from "../src/utils/operation.js";
import { scaleTextStyleToRegion } from "../src/utils/text-style.js";
import { describeIfPython } from "./helpers/python.js";

const clock = (overrides = {}) =>
  createOperation({
    mode: "datetime",
    clockStart: "2026-10-06T12:04:13",
    clockLayout: "split",
    ...overrides,
  });

describe("parseClockStart", () => {
  it("reads wall-clock input as UTC with optional seconds", () => {
    expect(parseClockStart("2026-10-06T12:04:13")).toBe(Date.UTC(2026, 9, 6, 12, 4, 13));
    expect(parseClockStart("2026-10-06T12:04")).toBe(Date.UTC(2026, 9, 6, 12, 4, 0));
    expect(parseClockStart("2026-10-06T12:04:13.000")).toBe(Date.UTC(2026, 9, 6, 12, 4, 13));
  });

  it.each([
    "",
    null,
    "2026-02-30T10:00:00",
    "2026-10-06T12:04:75",
    "2026-10-06 12:04:13",
    "2026-10-06T25:00",
    "x",
  ])("rejects %s", (value) => expect(parseClockStart(value)).toBeNull());

  it("round-trips the local wall clock of a Date", () => {
    const start = clockStartFromDate(new Date(2026, 9, 6, 7, 8, 9));
    expect(start).toBe("2026-10-06T07:08:09");
  });
});

describe("formatClockBlocks", () => {
  it("advances with source seconds and splits date and time", () => {
    expect(formatClockBlocks(clock(), 5.9)).toEqual(["06/10/2026", "12:04:18"]);
  });

  it("crosses midnight, month end and leap days", () => {
    expect(formatClockBlocks(clock({ clockStart: "2025-12-31T23:59:58" }), 3)).toEqual([
      "01/01/2026",
      "00:00:01",
    ]);
    expect(formatClockBlocks(clock({ clockStart: "2028-02-28T23:59:59" }), 1)).toEqual([
      "29/02/2028",
      "00:00:00",
    ]);
  });

  it("honours format, date order and single layout", () => {
    expect(formatClockBlocks(clock({ clockDateStyle: "mdy", clockFormat: "date" }), 0)).toEqual([
      "10/06/2026",
    ]);
    expect(formatClockBlocks(clock({ clockFormat: "time" }), 0)).toEqual(["12:04:13"]);
    expect(formatClockBlocks(clock({ clockLayout: "single", clockDateStyle: "ymd" }), 0)).toEqual([
      "2026/10/06 12:04:13",
    ]);
    expect(formatClockBlocks(clock({ clockStart: "" }), 0)).toEqual([]);
  });
});

describe("Fechero job payload", () => {
  it("exports only Fecheros with a valid start, as snake_case epoch seconds", () => {
    const ops = [clock(), clock({ clockStart: "nope" })];
    const exported = filterOperationsForExport(ops);
    expect(exported).toHaveLength(1);
    expect(operationToJobPayload(exported[0], 1920, 1080)).toMatchObject({
      mode: "datetime",
      clock_start_epoch: Date.UTC(2026, 9, 6, 12, 4, 13) / 1000,
      clock_format: "datetime",
      clock_layout: "split",
      clock_date_style: "dmy",
    });
  });

  it("falls back to known enum values", () => {
    expect(clockToJobPayload({ clockFormat: "bogus", clockLayout: 3 })).toMatchObject({
      clock_start_epoch: null,
      clock_format: "datetime",
      clock_layout: "single",
      clock_date_style: "dmy",
    });
  });

  it("keeps clock fields out of other operations' payloads", () => {
    expect(operationToJobPayload(createOperation({ mode: "blur" }), 10, 10)).not.toHaveProperty(
      "clock_start_epoch",
    );
  });
});

describe("DVR stamp", () => {
  it("sizes the font from the video height like the reference (47 px on 798 px)", () => {
    expect(dvrStampFontSize(798)).toBe(47);
    expect(dvrStampFontSize(1080)).toBe(64);
    expect(DVR_STAMP_REGION.h / (47 / 798)).toBeCloseTo(1.66, 1);
  });
});

describe("splitClockRegion", () => {
  it("fills the region with one gap between boxes", () => {
    const [date, time] = splitClockRegion({ x: 10, y: 5, w: 400, h: 40 }, [10, 8], 30, 6);
    expect(date.x).toBe(10);
    expect(time.x + time.w).toBe(410);
    expect(time.x - (date.x + date.w)).toBe(9);
  });
});

describeIfPython("splitClockRegion Python parity", () => {
  it("matches split_clock_region for every fixture", () => {
    const code = `
import json, sys
sys.path.insert(0, "python")
from datetime_stamp import split_clock_region
cases = json.load(open("resources/datetime-stamp-fixtures.json", encoding="utf-8"))["split"]
print(json.dumps([split_clock_region(c["region"], c["lengths"], c["fontSize"], c["inset"]) for c in cases]))
`;
    const result = spawnSync("python", ["-c", code], { encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    const expected = fixtures.split.map((c) =>
      splitClockRegion(c.region, c.lengths, c.fontSize, c.inset),
    );
    expect(JSON.parse(result.stdout)).toEqual(expected);
  });
});

describe("scaleTextStyleToRegion", () => {
  const dvr = {
    fontSize: 47,
    textScaleX: 2.06,
    letterSpacing: 2,
    boxBorderWidth: 4,
    safeMargin: 2,
  };
  const from = { x: 0.1, y: 0.05, w: 0.6, h: 0.1 };

  it("scales the font and pixel metrics with the height", () => {
    expect(scaleTextStyleToRegion(dvr, from, { ...from, h: 0.2 })).toMatchObject({
      fontSize: 94,
      textScaleX: 1.03,
      letterSpacing: 4,
      boxBorderWidth: 8,
      safeMargin: 4,
    });
  });

  it("keeps the font and stretches letters with the width", () => {
    expect(scaleTextStyleToRegion(dvr, from, { ...from, w: 0.3 })).toMatchObject({
      fontSize: 47,
      textScaleX: 1.03,
      letterSpacing: 2,
    });
  });

  it("keeps the look on a proportional resize and clamps to the style limits", () => {
    expect(scaleTextStyleToRegion(dvr, from, { ...from, w: 1.2, h: 0.2 })).toMatchObject({
      fontSize: 94,
      textScaleX: 2.06,
    });
    expect(scaleTextStyleToRegion(dvr, from, { ...from, w: 0.01, h: 0.001 })).toMatchObject({
      fontSize: 8,
      textScaleX: 0.5,
    });
  });
});
