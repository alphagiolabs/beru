import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import * as XLSXNamespace from "xlsx";

const XLSX = XLSXNamespace.default ?? XLSXNamespace;

const mocks = vi.hoisted(() => ({ handlers: new Map() }));

vi.mock("electron", () => ({
  app: { isPackaged: false },
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: {
    handle: vi.fn((channel, handler) => {
      mocks.handlers.set(channel, handler);
    }),
  },
  shell: { openPath: vi.fn(), showItemInFolder: vi.fn() },
}));

describe("fs:readExcel handler", () => {
  let tempDirectory;

  beforeEach(() => {
    mocks.handlers.clear();
    tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "beru-excel-"));
  });

  afterEach(() => {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  async function register() {
    const { registerFileHandlers } = await import("../main/handlers/file.js");
    const pathSecurity = {
      validateReadableFile: vi.fn((targetPath) => ({ ok: true, resolvedPath: targetPath })),
    };
    registerFileHandlers(pathSecurity);
    return { readExcel: mocks.handlers.get("fs:readExcel"), pathSecurity };
  }

  it("returns parsed rows and headers without a raw payload", async () => {
    const { readExcel } = await register();
    const ws = XLSX.utils.aoa_to_sheet([
      ["ID", "Nombre"],
      ["v1", "Ana"],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const filePath = path.join(tempDirectory, "tabla.xlsx");
    fs.writeFileSync(filePath, XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));

    await expect(readExcel({}, filePath)).resolves.toEqual({
      success: true,
      rows: [{ ID: "v1", Nombre: "Ana" }],
      headers: ["ID", "Nombre"],
    });
  });

  it("rejects empty files with the preserved error message", async () => {
    const { readExcel } = await register();
    const filePath = path.join(tempDirectory, "vacio.xlsx");
    fs.writeFileSync(filePath, "");

    await expect(readExcel({}, filePath)).resolves.toEqual({
      success: false,
      error: "Empty Excel file data",
    });
  });

  it("returns parse failures as errors", async () => {
    const { readExcel } = await register();
    const filePath = path.join(tempDirectory, "roto.xlsx");
    fs.writeFileSync(filePath, "not an excel file");

    const result = await readExcel({}, filePath);
    expect(result.success).toBe(false);
    expect(typeof result.error).toBe("string");
  });

  it("propagates path security denials", async () => {
    const { readExcel, pathSecurity } = await register();
    pathSecurity.validateReadableFile.mockReturnValue({ ok: false, error: "denegado" });

    await expect(readExcel({}, "C:\\otro\\tabla.xlsx")).resolves.toEqual({
      success: false,
      error: "denegado",
    });
  });
});
