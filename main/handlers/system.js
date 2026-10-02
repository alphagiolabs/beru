import { ipcMain } from "electron";
import { recommendBatchWorkers } from "../workerPolicy.js";
import { normalizeEncodeProfile } from "../encodeProfiles.js";
import { readSettings, detectHwEncoderCached } from "../utils/settings.js";
import { IPC_INVOKE } from "../../shared/ipc-channels.js";

export function registerSystemHandlers() {
  ipcMain.handle(IPC_INVOKE.getBatchCapacity, async (_event, opts = {}) => {
    const settings = readSettings();
    const mode = settings.batchWorkersMode === "conservative" ? "conservative" : "balanced";
    const jobCount = Math.max(1, Number(opts.jobCount) || 1);
    const maxSourcePixels = Math.max(0, Number(opts.maxSourcePixels) || 0);
    const hasVideoFilters = !!opts.hasVideoFilters;
    const encodeProfile = normalizeEncodeProfile(opts.encodeProfile || settings.encodeProfile);
    const explicitWorkers =
      Number(settings.batchWorkers) > 0 ? Math.floor(Number(settings.batchWorkers)) : 0;
    const hwEncoder = await detectHwEncoderCached();
    const rec = recommendBatchWorkers({
      hwEncoder,
      jobCount,
      maxSourcePixels,
      mode,
      explicitWorkers,
      hasVideoFilters,
      encodeProfile,
      jobEntries: Array.isArray(opts.jobs) ? opts.jobs : [],
    });
    return {
      ...rec,
      explicitWorkers,
    };
  });
}
