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
export const setIsProcessing = (val) => {
  _isProcessing = !!val;
};

export const getProcessingRunId = () => _processingRunId;

/**
 * Maximum lifetime of a processing run before the watchdog force-releases the
 * lock. Guards against a future refactor that throws between beginProcessingRun
 * and the matching clearProcessingRun, which would wedge the app until restart.
 */
export const PROCESSING_LOCK_MAX_MS = 5 * 60 * 1000;

let _processingLock = false;
let _processingWatchdog = null;

export const beginProcessingRun = (runId) => {
  if (_isProcessing || _processingLock) return false;
  _processingLock = true;
  _isProcessing = true;
  _processingRunId = runId;
  if (_processingWatchdog) clearTimeout(_processingWatchdog);
  _processingWatchdog = setTimeout(() => {
    // Only force-release if this is still the same run; a newer run sets its
    // own timer and must not be cleared by a stale one.
    if (_processingRunId === runId) {
      _isProcessing = false;
      _processingRunId = null;
      _processingLock = false;
      _processingWatchdog = null;
      console.error(
        `[beru] Processing lock watchdog fired for run ${runId} — ` +
          `force-releasing after ${PROCESSING_LOCK_MAX_MS}ms`,
      );
    }
  }, PROCESSING_LOCK_MAX_MS);
  // Don't keep the app alive on quit just for the watchdog.
  _processingWatchdog?.unref?.();
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
  return true;
};

let _lastProcessingError = null;
export const getLastProcessingError = () => _lastProcessingError;
export const setLastProcessingError = (err) => {
  _lastProcessingError = err;
};

// Re-export static-ish references used by many handlers
export const isDev = !app.isPackaged;
