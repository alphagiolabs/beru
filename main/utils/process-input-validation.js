import fs from "fs";

/**
 * Verifies that input_path points to a real, locally-readable file.
 *
 * fs.existsSync / fs.statSync can return true for OneDrive "Files On-Demand"
 * placeholders and similar reparse points where the actual content is not
 * present locally. Passing such a path to ffmpeg triggers a raw ENOENT from
 * the subprocess, which is unhelpful to the user. We try to open the file
 * for reading to confirm the content is actually accessible.
 */
export function validateInputPathReadable(inputPath) {
  if (typeof inputPath !== "string" || !inputPath.trim()) {
    return { ok: false, code: "missing", message: "Ruta de video vacía" };
  }
  let stat;
  try {
    stat = fs.statSync(inputPath);
  } catch {
    return { ok: false, code: "missing", message: "Archivo no encontrado" };
  }
  if (!stat.isFile()) {
    return { ok: false, code: "not_file", message: "La ruta no es un archivo" };
  }
  if (stat.size === 0) {
    return {
      ok: false,
      code: "empty",
      message: "El archivo está vacío (0 bytes)",
    };
  }
  // Probe open() — OneDrive cloud placeholders can stat fine but fail to open.
  let handle;
  try {
    handle = fs.openSync(inputPath, "r");
  } catch (e) {
    if (e?.code === "ENOENT") {
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
      message: `No se puede leer el archivo: ${e.message}`,
    };
  } finally {
    if (handle != null) {
      try {
        fs.closeSync(handle);
      } catch {}
    }
  }
  return { ok: true, size: stat.size };
}

export function findUnreadableInputs(jobs) {
  const issues = [];
  for (const job of jobs) {
    const inputPath = job?.input_path;
    if (!inputPath) continue;
    const check = validateInputPathReadable(inputPath);
    if (!check.ok) {
      issues.push({ inputPath, ...check });
    }
  }
  return issues;
}

/**
 * Translates raw subprocess error text (Python / ffmpeg stderr) into a message
 * the user can act on. Currently handles ENOENT, which usually means a cloud
 * sync placeholder (OneDrive, Dropbox, Google Drive) whose content is not
 * present locally.
 */
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
    // Font / drawtext ENOENT: ffmpeg could not open the fontfile referenced in
    // the overlay filter.  Mirror python/batch_errors.py so the JS and Python
    // surfaces agree regardless of whether the error arrives as a formatted
    // per-job message or as a raw stderr snippet.
    const lower = msg.toLowerCase();
    if (lower.includes("fontfile") || lower.includes("drawtext") || lower.includes("font")) {
      return (
        "No se encontró una fuente tipográfica necesaria para el texto. " +
        "Instala la fuente indicada en el overlay o cambia a una fuente del sistema " +
        "(Arial, Times New Roman, etc.) y vuelve a intentar."
      );
    }
    // Cloud placeholder guidance only when the path/message looks cloud-related.
    // Other ENOENT (missing assets, bad paths) keep a generic missing-file text.
    const cloudHint =
      /onedrive|dropbox|google drive|gdrive|files on-?demand|cloud/i.test(msg) ||
      /\\onedrive|\/onedrive|\\dropbox|\/dropbox/i.test(msg);
    if (cloudHint) {
      return (
        "El video no está disponible localmente. " +
        "Si está en OneDrive / Google Drive / Dropbox, espere a que se descargue o desactive 'Archivos a petición'."
      );
    }
    return "No se encontró un archivo necesario para el procesamiento. Comprueba rutas de entrada, imágenes y fuentes.";
  }
  return msg;
}
