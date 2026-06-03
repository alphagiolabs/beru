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
  if (!_isProcessing) _processingRunId = null;
};

export const getProcessingRunId = () => _processingRunId;
export const beginProcessingRun = (runId) => {
  if (_isProcessing) return false;
  _isProcessing = true;
  _processingRunId = runId;
  return true;
};
export const clearProcessingRun = (runId) => {
  if (runId && _processingRunId !== runId) return false;
  _isProcessing = false;
  _processingRunId = null;
  return true;
};

let _lastProcessingError = null;
export const getLastProcessingError = () => _lastProcessingError;
export const setLastProcessingError = (err) => {
  _lastProcessingError = err;
};

// Re-export static-ish references used by many handlers
export const isDev = !app.isPackaged;
