import { spawn } from "child_process";
import { buildProcessorChildEnv, validateProcessorAvailableAsync } from "./processor-spawn.js";
import { validateMediaBinaries } from "./paths.js";
import { createLineWorker } from "./line-worker.js";

const STARTUP_TIMEOUT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_RESPONSE_LINE_BYTES = 6 * 1024 * 1024;
const MAX_REQUEST_BYTES = 1024 * 1024;
const OUTPUT_LIMIT_ERROR = "La salida del preview supera el límite de tamaño";

let nextRequestId = 1;
const pending = new Map();
let activeRequestId = null;
let queuedRequestId = null;

function clearRequestQueue() {
  activeRequestId = null;
  queuedRequestId = null;
}

function settleRequest(id, result, dispatchNext = true) {
  const request = pending.get(id);
  if (!request) return;
  pending.delete(id);
  if (request.timer) clearTimeout(request.timer);
  if (activeRequestId === id) activeRequestId = null;
  if (queuedRequestId === id) queuedRequestId = null;
  request.resolve(result);
  if (dispatchNext) dispatchQueuedRequest(request.proc);
}

function settleAll(result) {
  for (const id of [...pending.keys()]) settleRequest(id, result, false);
  clearRequestQueue();
}

function settleWorkerRequests(proc, result) {
  for (const [id, request] of [...pending]) {
    if (request.proc === proc) settleRequest(id, result, false);
  }
}

const previewWorker = createLineWorker({
  name: "Preview worker",
  startupTimeoutMs: STARTUP_TIMEOUT_MS,
  startupTimeoutMessage: "Timeout al iniciar el preview",
  startupFailedMessage: "No se pudo iniciar el preview",
  overflowError: OUTPUT_LIMIT_ERROR,
  maxPendingLineBytes: MAX_RESPONSE_LINE_BYTES,
  stderrTailChars: 4000,
  spawnProc: (spawnSpec) => {
    const media = validateMediaBinaries();
    const mediaOpts = media.ok
      ? { ffmpegPath: media.ffmpegPath, ffprobePath: media.ffprobePath }
      : {};
    return spawn(spawnSpec.command, spawnSpec.args, {
      windowsHide: true,
      env: buildProcessorChildEnv(process.env, mediaOpts),
    });
  },
  onMessage: (msg) => {
    if (msg && Number.isInteger(msg.id)) {
      const { id, ...result } = msg;
      settleRequest(id, result);
    }
  },
  onStopped: (proc, outcome) => settleWorkerRequests(proc, outcome),
  outcomeFor: (cause, { error }) =>
    cause === "stdin" ? { ok: false, error: "Preview worker se cerró" } : { ok: false, error },
});

function dispatchQueuedRequest(proc) {
  if (activeRequestId !== null || queuedRequestId === null) return;
  if (!previewWorker.isUsable(proc)) return;
  const id = queuedRequestId;
  queuedRequestId = null;
  const request = pending.get(id);
  if (!request) return;
  activeRequestId = id;
  request.timer = setTimeout(() => {
    previewWorker.stop(proc, { ok: false, error: "Timeout al renderizar el frame" });
  }, REQUEST_TIMEOUT_MS);
  try {
    const sent = previewWorker.send(
      proc,
      { id, payload: request.payload },
      {
        maxBytes: MAX_REQUEST_BYTES,
        onWriteError: (err) =>
          previewWorker.stop(proc, {
            ok: false,
            error: `Preview worker stdin error: ${err.message}`,
          }),
      },
    );
    if (!sent) {
      settleRequest(id, { ok: false, error: "La solicitud de preview supera el límite de tamaño" });
      return;
    }
  } catch (err) {
    previewWorker.stop(proc, { ok: false, error: err.message });
  }
}

export async function renderSourceFrame(payload) {
  return renderPreviewFrame({ ...payload, source_only: true });
}

export async function renderPreviewFrame(payload) {
  const processorCheck = await validateProcessorAvailableAsync();
  if (!processorCheck.ok) {
    return { ok: false, error: processorCheck.error };
  }

  let proc;
  try {
    const { command, args } = processorCheck;
    proc = await previewWorker.ensure({
      command,
      args: [...args, "--preview-frame-worker"],
    });
  } catch (err) {
    return { ok: false, error: err.message };
  }

  return new Promise((resolve) => {
    const id = nextRequestId++;
    pending.set(id, { resolve, timer: null, proc, payload });
    if (activeRequestId === null) {
      queuedRequestId = id;
      dispatchQueuedRequest(proc);
      return;
    }
    if (queuedRequestId !== null) {
      settleRequest(
        queuedRequestId,
        { ok: false, cancelled: true, error: "Preview sustituido" },
        false,
      );
    }
    queuedRequestId = id;
  });
}

export function disposePreviewFrameWorker() {
  settleAll({ ok: false, cancelled: true, error: "Preview cancelado" });
  previewWorker.dispose({ ok: false, cancelled: true, error: "Preview cancelado" });
}
