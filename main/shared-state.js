/** Shared mutable state for the main process.  Centralized to avoid circular
 * imports between main.js and the handler modules. */

import { app } from "electron";

let _mainWindow = null;
export const getMainWindow = () => _mainWindow;
export const setMainWindow = (win) => {
  _mainWindow = win;
};

let _pythonProcess = null;
export const getPythonProcess = () => _pythonProcess;
export const setPythonProcess = (proc) => {
  _pythonProcess = proc;
};

let _currentTmpFile = null;
export const getCurrentTmpFile = () => _currentTmpFile;
export const setCurrentTmpFile = (file) => {
  _currentTmpFile = file;
};

let _isProcessing = false;
let _processingRunId = null;
export const getIsProcessing = () => _isProcessing;
// NOTE: there is intentionally no setIsProcessing. _isProcessing must always be
// mutated together with _processingLock via beginProcessingRun/clearProcessingRun
// (and the watchdog). A standalone setter that touched only _isProcessing would
// desync the lock and wedge the next run until the watchdog fires.

export const getProcessingRunId = () => _processingRunId;

/**
 * Maximum lifetime of a processing run before the watchdog force-releases the
 * lock. Guards against a future refactor that throws between beginProcessingRun
 * and the matching clearProcessingRun, which would wedge the app until restart.
 */
export const PROCESSING_LOCK_MAX_MS = 5 * 60 * 1000;

let _processingLock = false;
let _processingWatchdog = null;
// True during the pre-spawn probe phase (enrichJobVideoInfo / ffprobe of the
// batch). The processor child does not exist yet, so isPythonChildAlive() is
// false and the watchdog would otherwise fire mid-probe on large batches and
// force-release the lock. While this is set, the watchdog rearms instead.
let _probePhaseActive = false;
export const getProbePhaseActive = () => _probePhaseActive;
export const setProbePhaseActive = (active) => {
  _probePhaseActive = Boolean(active);
};

function isPythonChildAlive(proc) {
  return Boolean(proc && proc.exitCode == null && proc.signalCode == null && !proc.killed);
}

function armProcessingWatchdog(runId) {
  if (_processingWatchdog) clearTimeout(_processingWatchdog);
  _processingWatchdog = setTimeout(() => {
    // Only force-release if this is still the same run; a newer run sets its
    // own timer and must not be cleared by a stale one.
    if (_processingRunId !== runId) return;

    // Long batches legitimately exceed PROCESSING_LOCK_MAX_MS — keep checking
    // while the processor child is still alive OR we are still in the probe
    // phase (no child yet, but ffprobe work is in progress).
    if (isPythonChildAlive(_pythonProcess) || _probePhaseActive) {
      armProcessingWatchdog(runId);
      return;
    }

    _isProcessing = false;
    _processingRunId = null;
    _processingLock = false;
    _processingWatchdog = null;
    _probePhaseActive = false;
    console.error(
      `[beru] Processing lock watchdog fired for run ${runId} — ` +
        `force-releasing after ${PROCESSING_LOCK_MAX_MS}ms`,
    );
  }, PROCESSING_LOCK_MAX_MS);
  // Don't keep the app alive on quit just for the watchdog.
  _processingWatchdog?.unref?.();
}

export const beginProcessingRun = (runId) => {
  if (_isProcessing || _processingLock) return false;
  _processingLock = true;
  _isProcessing = true;
  _processingRunId = runId;
  armProcessingWatchdog(runId);
  return true;
};
export const clearProcessingRun = (runId) => {
  if (runId && _processingRunId !== runId) return false;
  if (_processingWatchdog) {
    clearTimeout(_processingWatchdog);
    _processingWatchdog = null;
  }
  _isProcessing = false;
  _processingRunId = null;
  _processingLock = false;
  _probePhaseActive = false;
  return true;
};

let _lastProcessingError = null;
export const getLastProcessingError = () => _lastProcessingError;
export const setLastProcessingError = (err) => {
  _lastProcessingError = err;
};

// Re-export static-ish references used by many handlers
export const isDev = !app.isPackaged;
