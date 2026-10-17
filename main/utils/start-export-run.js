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

async function prepareRun(
  { jobs, manifest, owner, events, validateSources, selectOutput, existingOutputPolicy },
  pathSecurity,
  options,
  preparation,
) {
  const batch = jobs[0].kind === "video";
  const cancelled = () => ({
    success: false,
    cancelled: true,
    ...(batch ? { error: "Procesamiento cancelado" } : {}),
  });
  const current = () => isProcessingPreparationCurrent(preparation);
  const sourceError = validateSources?.();
  if (!current()) return cancelled();
  if (sourceError) return { success: false, error: sourceError };
  const spawnSpec = await validateProcessorAvailableAsync();
  if (!current()) return cancelled();
  if (!spawnSpec.ok) return { success: false, error: spawnSpec.error };
  const binaries = validateMediaBinaries();
  if (!binaries.ok) return { success: false, error: binaries.error };
  let outputDirectory;
  if (selectOutput) {
    const destination = await selectOutput();
    if (!current()) return cancelled();
    if (!destination.success) return destination;
    outputDirectory = destination.outputDirectory;
    jobs = jobs.map((job) => ({ ...job, output_path: destination.output }));
  } else outputDirectory = pathSecurity.getOutputDirectory();
  if (!outputDirectory)
    return batch
      ? { success: false, error: "Selecciona una carpeta de salida antes de procesar" }
      : { success: false, errorCode: "OUTPUT_NOT_SELECTED" };

  const safeJobs = await sanitizeBatchJobMedia(jobs, pathSecurity, { outputDirectory });
  if (!current()) return cancelled();
  await validateBatchOutputPaths(safeJobs);
  if (!current()) return cancelled();
  const unreadable = await findUnreadableInputsAsync(safeJobs);
  if (!current()) return cancelled();
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
  if (!current()) return cancelled();
  if (existingOutputs.length && existingOutputPolicy !== "preserve")
    return { success: false, code: "output_exists", existingOutputs };
  return {
    success: true,
    runOptions: { manifest, jobs: safeJobs, outputDirectory, spawnSpec, overwrite, owner, events },
  };
}

export async function startExportRun(spec, pathSecurity, options = {}) {
  const preparation = captureProcessingPreparation(spec.owner);
  let ready;
  try {
    ready = await prepareRun(spec, pathSecurity, options, preparation);
  } catch (error) {
    ready = { success: false, error: error.message };
  }
  // This final check also covers cancellation in the preparation's resolution microtask.
  if (!isProcessingPreparationCurrent(preparation))
    return {
      success: false,
      cancelled: true,
      ...(spec.jobs[0].kind === "video" ? { error: "Procesamiento cancelado" } : {}),
    };
  if (!ready.success) return ready;
  const result = await executeProcessingRun(ready.runOptions);
  if (result?.success && ready.runOptions.jobs[0].kind === "stabilization")
    pathSecurity.registerAllowedPath(ready.runOptions.jobs[0].output_path, "video");
  return result;
}
