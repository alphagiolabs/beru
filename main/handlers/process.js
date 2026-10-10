import { executeProcessingRun, cancelRun } from "../processing-run.js";
import { validateMediaBinaries } from "../utils/paths.js";
import { validateProcessorAvailableAsync } from "../utils/processor-spawn.js";
import { unwrapJobManifest } from "../utils/jobManifest.js";
import { IPC_INVOKE } from "../../shared/ipc-channels.js";
import { handleIpc } from "../utils/ipc.js";
import { findUnreadableInputsAsync } from "../utils/process-input-validation.js";
import { sanitizeBatchJobMedia } from "../utils/process-media-validation.js";
import { validateBatchOutputPaths } from "../utils/process-output.js";

export function registerProcessHandlers(pathSecurity) {
  let validationGeneration = 0;
  handleIpc(IPC_INVOKE.startProcessing, async (_event, payload) => {
    const generation = validationGeneration;
    const { jobs, manifest, error } = unwrapJobManifest(payload);
    if (error) {
      return { success: false, error };
    }
    if (!Array.isArray(jobs) || jobs.length === 0) {
      return { success: false, error: "No hay videos para procesar" };
    }

    const processorCheck = await validateProcessorAvailableAsync();
    if (!processorCheck.ok) {
      return { success: false, error: processorCheck.error };
    }

    const mediaCheck = validateMediaBinaries();
    if (!mediaCheck.ok) {
      return { success: false, error: mediaCheck.error };
    }

    const outputDirectory = pathSecurity.getOutputDirectory();
    if (!outputDirectory) {
      return { success: false, error: "Selecciona una carpeta de salida antes de procesar" };
    }

    let safeJobs;
    try {
      safeJobs = await sanitizeBatchJobMedia(jobs, pathSecurity, { outputDirectory });
      await validateBatchOutputPaths(safeJobs);
    } catch (securityError) {
      return { success: false, error: securityError.message };
    }

    const unreadable = await findUnreadableInputsAsync(safeJobs);
    if (generation !== validationGeneration) {
      return { success: false, cancelled: true, error: "Procesamiento cancelado" };
    }
    if (unreadable.length > 0) {
      const first = unreadable[0];
      return {
        success: false,
        error: first.message,
        unreadableInputs: unreadable.map((u) => ({
          path: u.inputPath,
          code: u.code,
        })),
      };
    }

    return executeProcessingRun({
      manifest,
      jobs: safeJobs,
      outputDirectory,
      spawnSpec: processorCheck,
    });
  });

  handleIpc(IPC_INVOKE.cancelProcessing, async () => {
    validationGeneration++;
    const result = await cancelRun();
    return { ...result, idle: !!result?.idle };
  });
}
