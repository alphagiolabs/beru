// Python emits these NDJSON payloads; main adds runId when forwarding them over IPC.
// Required fields describe the producer contract, not a keepalive whitelist.
export const RUN_EVENTS = {
  progress: {
    type: "progress",
    requiredFields: ["current", "total", "file", "succeeded", "failed"],
    subscription: "onProgress",
  },
  jobProgress: {
    type: "job_progress",
    requiredFields: ["index", "percent", "speed"],
    subscription: "onJobProgress",
  },
  complete: {
    type: "complete",
    requiredFields: ["index", "output"],
    subscription: "onComplete",
  },
  cancelled: {
    type: "cancelled",
    requiredFields: ["index"],
    subscription: "onJobCancelled",
  },
  error: {
    type: "error",
    requiredFields: ["error"],
    subscription: "onError",
    // An integer index (including negative derived-media IDs) makes this a Job error.
    // Missing/null index is a Run error; neither form changes the NDJSON type.
    jobSubscription: "onJobError",
  },
  summary: {
    type: "summary",
    requiredFields: ["total", "succeeded", "failed", "cancelled", "workers", "copy_workers"],
    subscription: "onSummary",
  },
  warning: {
    type: "warning",
    requiredFields: ["index", "code", "message"],
    subscription: "onRunWarning",
  },
};

// Main owns the run lifecycle; the worker's run_end is consumed before IPC dispatch.
export const RUN_LIFECYCLE = { started: "onRunStarted", finished: "onFinished" };
export const WORKER_EVENTS = { ready: "ready", runEnd: "run_end" };

export const RUN_WARNING_KEYS = {
  patch_skipped_timing: "errors.patchSkippedTiming",
  patch_skipped_budget: "errors.patchSkippedBudget",
  patch_skipped_too_large: "errors.patchSkippedTooLarge",
};

// Every valid event envelope proves liveness, even when its type is newer than JS.
// Unknown types are ignored by dispatch; malformed JSON/envelopes do not keep a run alive.
export function isRunEvent(message) {
  return Boolean(
    message &&
    typeof message === "object" &&
    !Array.isArray(message) &&
    typeof message.type === "string" &&
    message.type.trim(),
  );
}
