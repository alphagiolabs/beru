import { handleIpc } from "../utils/ipc.js";
import { IPC_INVOKE } from "../../shared/ipc-channels.js";
import { isStabilizationJob } from "../../shared/stabilization.js";
import { unwrapJobManifest } from "../utils/jobManifest.js";
import { executeProcessingRun } from "../processing-run.js";
import { validateProcessorAvailableAsync } from "../utils/processor-spawn.js";
import { validateMediaBinaries } from "../utils/paths.js";
import { sanitizeBatchJobMedia } from "../utils/process-media-validation.js";
import { validateBatchOutputPaths, deriveOutputPath } from "../utils/process-output.js";
import { findUnreadableInputsAsync } from "../utils/process-input-validation.js";
import {
  captureProcessingPreparation,
  isProcessingPreparationCurrent,
} from "../utils/process-preparation.js";

export function registerStabilizationHandlers(pathSecurity) {
  handleIpc(IPC_INVOKE.startStabilization, async (_event, payload) => {
    const generation = captureProcessingPreparation();
    const { jobs, manifest, error } = unwrapJobManifest(payload);
    if (error || jobs?.length !== 1 || !isStabilizationJob(jobs[0]))
      return { success: false, errorCode: "STABILIZATION_INVALID" };
    const spawnSpec = await validateProcessorAvailableAsync();
    if (!spawnSpec.ok) return { success: false, error: spawnSpec.error };
    const binaries = validateMediaBinaries();
    if (!binaries.ok) return { success: false, error: binaries.error };
    const outputDirectory = pathSecurity.getOutputDirectory();
    if (!outputDirectory) return { success: false, errorCode: "OUTPUT_NOT_SELECTED" };
    let safeJob;
    try {
      [safeJob] = await sanitizeBatchJobMedia(jobs, pathSecurity);
      safeJob = {
        ...safeJob,
        output_path: deriveOutputPath(outputDirectory, jobs[0].output_path),
        output_root: outputDirectory,
      };
      await validateBatchOutputPaths([safeJob]);
      const unreadable = await findUnreadableInputsAsync([safeJob]);
      if (unreadable.length)
        return { success: false, errorCode: "MEDIA_UNREADABLE", unreadableInputs: unreadable };
    } catch (error) {
      return { success: false, error: error.message };
    }
    if (!isProcessingPreparationCurrent(generation)) return { success: false, cancelled: true };
    const result = await executeProcessingRun({
      manifest,
      jobs: [safeJob],
      outputDirectory,
      spawnSpec,
    });
    if (result?.success) pathSecurity.registerAllowedPath(safeJob.output_path, "video");
    return result;
  });
}
