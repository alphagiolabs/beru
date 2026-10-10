import { describe, expect, it } from "vitest";
import * as XLSXNamespace from "xlsx";
import { extractSheetData, parseExcelBuffer } from "../main/utils/excel.js";

const XLSX = XLSXNamespace.default ?? XLSXNamespace;

function legacyExtract(ws) {
  const rows = XLSX.utils.sheet_to_json(ws);
  const headerRow = (
    XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: "" })[0] || []
  )
    .map((h) => String(h).trim())
    .filter(Boolean);
  const headers = [...new Set([...headerRow, ...rows.flatMap((r) => Object.keys(r || {}))])];
  return { rows, headers };
}

async function expectEquivalent(ws) {
  const next = await extractSheetData(ws);
  const legacy = legacyExtract(ws);
  expect(next.rows).toEqual(legacy.rows);
  expect(next.headers).toEqual(legacy.headers);
  return next;
}

describe("extractSheetData", () => {
  it("rejects oversized worksheet ranges before traversing their cells", async () => {
    await expect(extractSheetData({ "!ref": "A1:XFD1048576" })).rejects.toThrow(/limit/);
  });
  it("matches the legacy double conversion on sparse data rows", async () => {
    const ws = XLSX.utils.json_to_sheet([{ ID: "a" }, { ID: "b", Monto: 5, Extra: "e2" }], {
      header: ["ID", "Monto", "Extra"],
    });
    const { headers } = await expectEquivalent(ws);
    expect(headers).toEqual(["ID", "Monto", "Extra"]);
  });

  it("matches the legacy double conversion on numeric header cells", async () => {
    const ws = XLSX.utils.aoa_to_sheet([
      [2024, "Nombre"],
      ["v1", "Ana"],
    ]);
    const { headers } = await expectEquivalent(ws);
    expect(headers).toEqual(["2024", "Nombre"]);
  });

  it("preserves numeric and formatted header names", async () => {
    const ws = {
      "!ref": "A1:B3",
      A1: { t: "z", v: 1 },
      B1: { t: "n", v: 45292, z: "m/d/yy" },
      A2: { t: "s", v: "a" },
      B2: { t: "n", v: 1 },
      A3: { t: "s", v: "b" },
      B3: { t: "n", v: 2 },
    };
    const { rows, headers } = await extractSheetData(ws);
    expect(headers).toEqual(["45292", "", "1/1/24"]);
    expect(rows).toEqual([
      { "": "a", "1/1/24": 1 },
      { "": "b", "1/1/24": 2 },
    ]);
  });

  it("matches the legacy double conversion on duplicate headers", async () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["ID", "ID"],
      ["a", "b"],
    ]);
    const { headers } = await expectEquivalent(ws);
    expect(headers).toEqual(["ID", "ID_1"]);
  });

  it("matches the legacy double conversion on a header-only sheet", async () => {
    const ws = XLSX.utils.aoa_to_sheet([["ID", "Nombre"]]);
    const next = await expectEquivalent(ws);
    expect(next.rows).toEqual([]);
  });

  it("matches the legacy failure on unknown cell types in the header row", async () => {
    const ws = {
      "!ref": "A1:B2",
      A1: { t: "str", v: "x" },
      B1: { t: "s", v: "Col" },
      A2: { t: "s", v: "a" },
      B2: { t: "s", v: "b" },
    };
    expect(() => legacyExtract(ws)).toThrow("unrecognized type");
    await expect(extractSheetData(ws)).rejects.toThrow("unrecognized type");
  });

  it("treats literal null cells as missing values", async () => {
    const ws = {
      "!ref": "A1:B2",
      A1: null,
      B1: { t: "s", v: "Col" },
      A2: { t: "s", v: "a" },
      B2: { t: "s", v: "b" },
    };
    await expect(extractSheetData(ws)).resolves.toEqual({
      rows: [{ __EMPTY: "a", Col: "b" }],
      headers: ["Col", "__EMPTY"],
    });
  });

  it("matches the legacy result on a null worksheet", async () => {
    const next = await expectEquivalent(null);
    expect(next.rows).toEqual([]);
    expect(next.headers).toEqual([]);
  });

  it("reads rows and headers from dense worksheets", async () => {
    const ws = XLSX.utils.aoa_to_sheet(
      [
        ["ID", "Nombre"],
        ["v1", "Ana"],
      ],
      { dense: true },
    );
    await expect(extractSheetData(ws)).resolves.toEqual({
      rows: [{ ID: "v1", Nombre: "Ana" }],
      headers: ["ID", "Nombre"],
    });
  });
});

describe("parseExcelBuffer", () => {
  function toBuffer(ws, bookType = "xlsx") {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    return XLSX.write(wb, { type: "buffer", bookType });
  }

  it("parses rows and headers from a workbook buffer", async () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["ID", "Nombre"],
      ["v1", "Ana"],
      ["v2", "Luis"],
    ]);
    const { rows, headers } = await parseExcelBuffer(toBuffer(ws));
    expect(rows).toEqual([
      { ID: "v1", Nombre: "Ana" },
      { ID: "v2", Nombre: "Luis" },
    ]);
    expect(headers).toEqual(["ID", "Nombre"]);
  });

  it.each(["xlsx", "xls"])("preserves Unicode when parsing %s files", async (bookType) => {
    const ws = XLSX.utils.aoa_to_sheet([["Nombre"], ["José 日本語"]]);
    await expect(parseExcelBuffer(toBuffer(ws, bookType))).resolves.toEqual({
      rows: [{ Nombre: "José 日本語" }],
      headers: ["Nombre"],
    });
  });

  it("rejects a sheet without data rows", async () => {
    const ws = XLSX.utils.aoa_to_sheet([["ID", "Nombre"]]);
    await expect(parseExcelBuffer(toBuffer(ws))).rejects.toThrow("Empty sheet");
  });

  it("rejects unreadable workbook data", async () => {
    await expect(parseExcelBuffer(Buffer.from("not an excel file"))).rejects.toThrow();
  });
});
