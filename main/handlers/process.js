import { startExportRun } from "../utils/start-export-run.js";
import { cancelRun } from "../processing-run.js";
import { cancelProcessingPreparation } from "../utils/process-preparation.js";
import { unwrapJobManifest } from "../utils/jobManifest.js";
import { IPC_INVOKE } from "../../shared/ipc-channels.js";
import { handleIpc } from "../utils/ipc.js";

export function registerProcessHandlers(pathSecurity) {
  handleIpc(IPC_INVOKE.startProcessing, async (_event, payload, options) => {
    const { jobs, manifest, error } = unwrapJobManifest(payload);
    if (error) {
      return { success: false, error };
    }
    if (!Array.isArray(jobs) || jobs.length === 0) {
      return { success: false, error: "No hay videos para procesar" };
    }
    if (jobs.some((job) => job.kind && job.kind !== "video"))
      return { success: false, error: "Unsupported batch job kind" };

    return startExportRun({ manifest, jobs }, pathSecurity, options);
  });

  handleIpc(IPC_INVOKE.cancelProcessing, async () => {
    cancelProcessingPreparation();
    const result = await cancelRun();
    return { ...result, idle: !!result?.idle };
  });
}
