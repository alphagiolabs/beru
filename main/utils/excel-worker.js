import { parentPort, workerData } from "node:worker_threads";
import XLSX from "xlsx";
import { extractSheetData } from "./excel.js";

try {
  const wb = XLSX.read(Buffer.from(workerData), { type: "buffer", dense: true });
  const sheetName = wb.SheetNames?.[0];
  if (!sheetName) throw new Error("Excel file has no sheets");
  const data = await extractSheetData(wb.Sheets[sheetName]);
  if (data.rows.length === 0) throw new Error("Empty sheet");
  parentPort.postMessage({ ok: true, data });
} catch (error) {
  parentPort.postMessage({ ok: false, error: error.message });
}
