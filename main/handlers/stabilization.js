import { startExportRun } from "../utils/start-export-run.js";
import { handleIpc } from "../utils/ipc.js";
import { IPC_INVOKE } from "../../shared/ipc-channels.js";
import { isStabilizationJob } from "../../shared/stabilization.js";
import { unwrapJobManifest } from "../utils/jobManifest.js";

export function registerStabilizationHandlers(pathSecurity) {
  handleIpc(IPC_INVOKE.startStabilization, async (_event, payload, options) => {
    const { jobs, manifest, error } = unwrapJobManifest(payload);
    if (error || jobs?.length !== 1 || !isStabilizationJob(jobs[0]))
      return { success: false, errorCode: "STABILIZATION_INVALID" };
    return startExportRun({ manifest, jobs }, pathSecurity, options);
  });
}
