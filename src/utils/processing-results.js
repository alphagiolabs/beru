import {
  abortProcessingQueue,
  applyJobDone,
  applyJobError,
  applyJobCancelled,
  applyJobProgressBatch,
} from "./export-pipeline.js";
import { PERF_FLAGS } from "./perf-flags.js";

export function createQueueResults(jobs) {
  return {
    kind: null,
    accepts: (state, index) => state.queue[index]?.path === jobs.get(index),
    progress: (state, msg) => ({
      progressDone: msg.current ?? msg.done ?? state.progressDone,
      progressTotal: msg.total > 0 ? msg.total : state.progressTotal,
    }),
    jobProgress: (state, messages) => {
      const { queue, jobProgress } = applyJobProgressBatch({
        ...state,
        messages,
        progressMap: PERF_FLAGS.progressMap,
      });
      return queue === state.queue && jobProgress === state.jobProgress
        ? state
        : { queue, jobProgress };
    },
    result: (state, kind, msg, previous) => {
      const apply =
        kind === "done" ? applyJobDone : kind === "error" ? applyJobError : applyJobCancelled;
      const patch = apply({ ...state, msg, progressMap: PERF_FLAGS.progressMap });
      if (previous) patch.progressDone = state.progressDone;
      return patch;
    },
    summary: (_state, msg) => ({ batchSummary: msg }),
    finish: (state) => {
      const { queue, queueChanged } = abortProcessingQueue(state.queue);
      return { ...(queueChanged ? { queue } : {}), jobProgress: {} };
    },
  };
}

export function createArtifactResults(artifact) {
  return {
    kind: artifact.kind,
    accepts: (_state, index) => index === artifact.jobId,
    progress: (state) => state,
    jobProgress: (state, messages) =>
      messages.length
        ? { mediaExport: { ...state.mediaExport, progress: messages.at(-1).percent } }
        : state,
    result: (state, kind, msg) => ({
      mediaExport: {
        ...state.mediaExport,
        status: kind,
        progress: kind === "done" ? 100 : state.mediaExport?.progress,
        outputPath: kind === "done" ? msg.output : null,
        ...(kind === "done"
          ? {
              confirmedOutputPath: msg.output,
              confirmedSignature: state.mediaExport?.signature,
              confirmedAt: Date.now(),
              confirmedVariant: state.mediaExport?.variant,
              confirmedSourcePath: state.mediaExport?.sourcePath,
            }
          : {}),
        error: msg.error || null,
      },
    }),
    summary: (state, msg) => ({ mediaExport: { ...state.mediaExport, summary: msg } }),
    finish: (state, outcome) =>
      state.mediaExport?.status === "processing"
        ? {
            mediaExport: {
              ...state.mediaExport,
              status: outcome.cancelled ? "cancelled" : outcome.success ? "done" : "error",
              progress: outcome.success ? 100 : state.mediaExport.progress,
              error: outcome.error || null,
            },
          }
        : {},
  };
}
