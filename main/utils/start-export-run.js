import { executeProcessingRun } from "../processing-run.js";
import { validateMediaBinaries } from "./paths.js";
import { validateProcessorAvailableAsync } from "./processor-spawn.js";
import { sanitizeBatchJobMedia } from "./process-media-validation.js";
import { findExistingOutputs, validateBatchOutputPaths } from "./process-output.js";
import { findUnreadableInputsAsync } from "./process-input-validation.js";
import {
  captureProcessingPreparation,
  isProcessingPreparationCurrent,
} from "./process-preparation.js";

export async function startExportRun({ jobs, manifest }, pathSecurity, options) {
  const generation = captureProcessingPreparation();
  const batch = jobs[0].kind === "video";
  const cancelled = () => ({
    success: false,
    cancelled: true,
    ...(batch ? { error: "Procesamiento cancelado" } : {}),
  });
  const spawnSpec = await validateProcessorAvailableAsync();
  if (!isProcessingPreparationCurrent(generation)) return cancelled();
  if (!spawnSpec.ok) return { success: false, error: spawnSpec.error };
  const binaries = validateMediaBinaries();
  if (!binaries.ok) return { success: false, error: binaries.error };
  const outputDirectory = pathSecurity.getOutputDirectory();
  if (!outputDirectory)
    return batch
      ? { success: false, error: "Selecciona una carpeta de salida antes de procesar" }
      : { success: false, errorCode: "OUTPUT_NOT_SELECTED" };

  const safeJobs = await sanitizeBatchJobMedia(jobs, pathSecurity, { outputDirectory });
  await validateBatchOutputPaths(safeJobs);
  const unreadable = await findUnreadableInputsAsync(safeJobs);
  if (!isProcessingPreparationCurrent(generation)) return cancelled();
  if (unreadable.length)
    return batch
      ? {
          success: false,
          error: unreadable[0].message,
          unreadableInputs: unreadable.map((item) => ({ path: item.inputPath, code: item.code })),
        }
      : { success: false, errorCode: "MEDIA_UNREADABLE", unreadableInputs: unreadable };

  const overwrite = options?.overwrite === true;
  const existingOutputs = overwrite ? [] : await findExistingOutputs(safeJobs);
  if (!isProcessingPreparationCurrent(generation)) return cancelled();
  if (existingOutputs.length) return { success: false, code: "output_exists", existingOutputs };
  const result = await executeProcessingRun({
    manifest,
    jobs: safeJobs,
    outputDirectory,
    spawnSpec,
    overwrite,
  });
  if (result?.success && jobs[0].kind === "stabilization")
    pathSecurity.registerAllowedPath(safeJobs[0].output_path, "video");
  return result;
}
