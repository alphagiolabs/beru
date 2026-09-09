import { removeIncompleteOutput } from "./utils/process-output.js";
import { sendToRenderer } from "./utils/renderer.js";
import { setMediaProcessingActive } from "./utils/media-task-pool.js";

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

export const getProcessingRunId = () => _processingRunId;

export const hasActiveProcessing = () =>
  Boolean(_processingRunId || _isProcessing || _pythonProcess);

let _cancellingRunId = null;
export const getCancellingRunId = () => _cancellingRunId;
export const setCancellingRunId = (runId) => {
  _cancellingRunId = runId || null;
};
export const clearCancellingRunId = (runId) => {
  if (runId && _cancellingRunId !== runId) return false;
  _cancellingRunId = null;
  return true;
};

export const PROCESSING_LOCK_MAX_MS = 5 * 60 * 1000;

let _processingWatchdog = null;
let _probePhaseActive = false;
export const setProbePhaseActive = (active) => {
  _probePhaseActive = Boolean(active);
};

function isPythonChildAlive(proc) {
  return Boolean(proc && proc.exitCode == null && proc.signalCode == null && !proc.killed);
}

function armProcessingWatchdog(runId) {
  if (_processingWatchdog) clearTimeout(_processingWatchdog);
  _processingWatchdog = setTimeout(() => {
    if (_processingRunId !== runId) return;

    if (isPythonChildAlive(_pythonProcess) || _probePhaseActive) {
      armProcessingWatchdog(runId);
      return;
    }

    _isProcessing = false;
    _processingRunId = null;
    _processingWatchdog = null;
    setMediaProcessingActive(false);
    _probePhaseActive = false;
    console.error(
      `[beru] Processing lock watchdog fired for run ${runId} — ` +
        `force-releasing after ${PROCESSING_LOCK_MAX_MS}ms`,
    );
    const staleRunId = runId;
    sendToRenderer("process:error", {
      error: "El procesamiento se interrumpió de forma inesperada. Puedes volver a intentarlo.",
      runId: staleRunId,
    });
  }, PROCESSING_LOCK_MAX_MS);
  _processingWatchdog?.unref?.();
}

export const beginProcessingRun = (runId) => {
  if (_isProcessing) return false;
  _isProcessing = true;
  _processingRunId = runId;
  setMediaProcessingActive(true);
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
  _probePhaseActive = false;
  setMediaProcessingActive(false);
  return true;
};

let _lastProcessingError = null;
export const getLastProcessingError = () => _lastProcessingError;
export const setLastProcessingError = (err) => {
  _lastProcessingError = err;
};

let activeRunOutputSnapshot = null;

export function snapshotRunOutputsForCancel(jobs, outputRoot) {
  activeRunOutputSnapshot = {
    outputRoot,
    jobs: (jobs || []).map((job, index) => ({
      index,
      outputPath: job?.output_path,
      inputPath: job?.input_path,
    })),
    completedIndices: new Set(),
  };
}

export function markJobOutputComplete(index) {
  if (!activeRunOutputSnapshot) return;
  if (!Number.isInteger(index) || index < 0) return;
  activeRunOutputSnapshot.completedIndices.add(index);
}

export function clearRunOutputSnapshot() {
  activeRunOutputSnapshot = null;
}

export function cleanupIncompleteOutputsAfterCancel() {
  const snap = activeRunOutputSnapshot;
  if (!snap) return;
  try {
    for (const job of snap.jobs) {
      if (snap.completedIndices.has(job.index)) continue;
      removeIncompleteOutput(job.outputPath, {
        outputRoot: snap.outputRoot,
        inputPath: job.inputPath,
      });
    }
  } finally {
    clearRunOutputSnapshot();
  }
}
