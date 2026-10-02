import fs from "fs";
import { runWithConcurrency } from "./concurrency.js";

function missingInput() {
  return { ok: false, code: "missing", message: "Archivo no encontrado" };
}

function validateInputPath(inputPath) {
  return typeof inputPath === "string" && inputPath.trim()
    ? null
    : { ok: false, code: "missing", message: "Ruta de video vacía" };
}

function validateInputStat(stat) {
  if (!stat.isFile()) {
    return { ok: false, code: "not_file", message: "La ruta no es un archivo" };
  }
  if (stat.size === 0) {
    return { ok: false, code: "empty", message: "El archivo está vacío (0 bytes)" };
  }
  return null;
}

function unreadableInput(error) {
  if (error?.code === "ENOENT") {
    return {
      ok: false,
      code: "cloud_only",
      message:
        "El video no está disponible localmente. Si está en OneDrive, espere a que se descargue o desactive 'Archivos a petición'.",
    };
  }
  return {
    ok: false,
    code: "unreadable",
    message: `No se puede leer el archivo: ${error.message}`,
  };
}

function unreadableIssue(inputPath, check) {
  return check.ok ? null : { inputPath, ...check };
}

export async function validateInputPathReadableAsync(inputPath) {
  const pathError = validateInputPath(inputPath);
  if (pathError) return pathError;
  let stat;
  try {
    stat = await fs.promises.stat(inputPath);
  } catch {
    return missingInput();
  }
  const statError = validateInputStat(stat);
  if (statError) return statError;
  let handle;
  try {
    handle = await fs.promises.open(inputPath, "r");
  } catch (error) {
    return unreadableInput(error);
  } finally {
    if (handle) {
      try {
        await handle.close();
      } catch {}
    }
  }
  return { ok: true, size: stat.size };
}

export async function findUnreadableInputsAsync(jobs, limit = 8) {
  const results = await runWithConcurrency(jobs, limit, async (job) => {
    const inputPath = job?.input_path;
    if (!inputPath) return null;
    return unreadableIssue(inputPath, await validateInputPathReadableAsync(inputPath));
  });
  return results.filter(Boolean);
}

export function translateProcessorErrorMessage(msg) {
  if (typeof msg !== "string" || !msg) return msg;
  if (/spawn .* enoent/i.test(msg) && /py\b|python/i.test(msg)) {
    return (
      "Python 3 no está instalado o no está en el PATH. " +
      "Instálelo desde https://www.python.org/downloads/ (marque 'Add to PATH') " +
      "o defina BERU_PYTHON con la ruta al ejecutable."
    );
  }
  if (/ENOENT/.test(msg) || /No such file or directory/i.test(msg)) {
    const lower = msg.toLowerCase();
    if (lower.includes("fontfile") || lower.includes("drawtext") || lower.includes("font")) {
      return (
        "No se encontró una fuente tipográfica necesaria para el texto. " +
        "Instala la fuente indicada en el overlay o cambia a una fuente del sistema " +
        "(Arial, Times New Roman, etc.) y vuelve a intentar."
      );
    }
    if (/onedrive|dropbox|google drive|gdrive|files on-?demand|cloud/i.test(msg)) {
      return (
        "El video no está disponible localmente. " +
        "Si está en OneDrive / Google Drive / Dropbox, espere a que se descargue o desactive 'Archivos a petición'."
      );
    }
    return "No se encontró un archivo necesario para el procesamiento. Comprueba rutas de entrada, imágenes y fuentes.";
  }
  return msg;
}
