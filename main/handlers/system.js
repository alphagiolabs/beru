import { ipcMain } from "electron";
import os from "os";
import { recommendBatchWorkers } from "../workerPolicy.js";
import { normalizeEncodeProfile } from "../encodeProfiles.js";
import { readSettings, detectHwEncoderCached } from "../utils/settings.js";

export function registerSystemHandlers() {
  ipcMain.handle("system:getBatchCapacity", async (_event, opts = {}) => {
    const settings = readSettings();
    const mode = settings.batchWorkersMode === "conservative" ? "conservative" : "balanced";
    const jobCount = Math.max(1, Number(opts.jobCount) || 1);
    const maxSourcePixels = Math.max(0, Number(opts.maxSourcePixels) || 0);
    const hasVideoFilters = !!opts.hasVideoFilters;
    const encodeProfile = normalizeEncodeProfile(opts.encodeProfile || settings.encodeProfile);
    const explicitWorkers =
      Number(settings.batchWorkers) > 0 ? Math.floor(Number(settings.batchWorkers)) : 0;
    let hwEncoder = null;
    try {
      hwEncoder = await detectHwEncoderCached();
    } catch (err) {
      console.error("[beru] HW encoder detection failed:", err?.message || err);
    }
    const rec = recommendBatchWorkers({
      hwEncoder,
      jobCount,
      maxSourcePixels,
      mode,
      explicitWorkers,
      hasVideoFilters,
      encodeProfile,
    });
    return {
      ...rec,
      explicitWorkers,
      maxWorkersCap: 16,
    };
  });
}
