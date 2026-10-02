import { Worker as NodeWorker } from "node:worker_threads";
import { URL as NodeURL } from "node:url";

let xlsxModule = null;
let activeParses = 0;

async function loadXlsx() {
  if (!xlsxModule) {
    const mod = await import("xlsx");
    xlsxModule = mod.default ?? mod;
  }
  return xlsxModule;
}

function readHeaderRowValues(ws, utils) {
  const ref = ws && ws["!ref"];
  if (!ref) return [];
  const range = utils.decode_range(ref);
  for (let R = range.s.r; R <= range.e.r; R++) {
    const values = [];
    let hasValue = false;
    for (let C = range.s.c; C <= range.e.c; C++) {
      const cell = ws["!data"] ? (ws["!data"][R] || [])[C] : ws[utils.encode_cell({ r: R, c: C })];
      if (cell == null || cell.t === undefined) {
        values.push("");
        continue;
      }
      let v = cell.v;
      switch (cell.t) {
        case "z":
          if (v == null) break;
          continue;
        case "e":
          v = v == 0 ? null : undefined;
          break;
        case "s":
        case "d":
        case "b":
        case "n":
          break;
        default:
          throw new Error(`unrecognized type ${cell.t}`);
      }
      if (v == null) values.push(cell.t === "e" && v === null ? null : "");
      else {
        values.push(v);
        hasValue = true;
      }
    }
    if (hasValue) return values;
  }
  return [];
}

export async function extractSheetData(ws) {
  const XLSX = await loadXlsx();
  if (ws?.["!ref"]) {
    const range = XLSX.utils.decode_range(ws["!ref"]);
    const cells = (range.e.r - range.s.r + 1) * (range.e.c - range.s.c + 1);
    if (!Number.isFinite(cells) || cells > 1_000_000) {
      throw new Error("Excel sheet exceeds the limit of 1000000 cells");
    }
  }
  const rows = XLSX.utils.sheet_to_json(ws);
  const headerRow = readHeaderRowValues(ws, XLSX.utils)
    .map((h) => String(h).trim())
    .filter(Boolean);
  const headers = [...new Set([...headerRow, ...rows.flatMap((r) => Object.keys(r))])];
  return { rows, headers };
}

export async function parseExcelBuffer(buffer) {
  if (!buffer?.length || buffer.length > 25 * 1024 * 1024) {
    throw new Error("Excel file must contain between 1 byte and 25MB");
  }
  if (activeParses >= 2) throw new Error("Hay demasiadas importaciones Excel en curso");
  activeParses++;
  return new Promise((resolve, reject) => {
    let worker;
    let timer;
    let settled = false;
    const finish = async (error, data) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        await worker?.terminate();
      } catch (terminationError) {
        error ||= terminationError;
      } finally {
        activeParses--;
        if (error) reject(error);
        else resolve(data);
      }
    };
    try {
      worker = new NodeWorker(new NodeURL("./excel-worker.js", import.meta.url), {
        workerData: buffer,
        resourceLimits: { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 16 },
      });
      timer = setTimeout(() => void finish(new Error("Timeout al leer el archivo Excel")), 30_000);
      worker.once("message", (result) => {
        void finish(result.ok ? null : new Error(result.error), result.data);
      });
      worker.once("error", (error) => void finish(error));
      worker.once("exit", (code) => void finish(new Error(`Excel parser exited (${code})`)));
    } catch (error) {
      void finish(error);
    }
  });
}
