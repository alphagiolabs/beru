import { spawn } from "child_process";
import { buildProcessorChildEnv, validateProcessorAvailableAsync } from "./processor-spawn.js";
import { validateMediaBinaries } from "./paths.js";
import { killProcessTree } from "./kill-process-tree.js";

const STARTUP_TIMEOUT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 60_000;

let worker = null;
let workerStartPromise = null;
let workerReady = false;
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
  clearRequestQueue();
}

function killIfCurrentWorker(proc) {
  if (worker !== proc) return;
  void killProcessTree(proc).catch(() => {
    try {
      proc.kill();
    } catch {}
  });
}

function dispatchQueuedRequest(proc) {
  if (activeRequestId !== null || queuedRequestId === null) return;
  if (worker !== proc || !workerReady || proc.killed) return;
  const id = queuedRequestId;
  queuedRequestId = null;
  const request = pending.get(id);
  if (!request) return;
  activeRequestId = id;
  request.timer = setTimeout(() => {
    killIfCurrentWorker(proc);
    settleRequest(id, { ok: false, error: "Timeout al renderizar el frame" }, false);
  }, REQUEST_TIMEOUT_MS);
  try {
    proc.stdin.write(`${JSON.stringify({ id, payload: request.payload })}\n`, (err) => {
      if (!err) return;
      settleRequest(id, { ok: false, error: err.message }, false);
      killIfCurrentWorker(proc);
    });
  } catch (err) {
    settleRequest(id, { ok: false, error: err.message }, false);
    killIfCurrentWorker(proc);
  }
}

function parseWorkerLine(line) {
  if (!line.trim()) return null;
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function startWorker(spawnSpec) {
  if (worker && workerReady && !worker.killed) return Promise.resolve(worker);
  if (workerStartPromise) return workerStartPromise;

  workerStartPromise = new Promise((resolve, reject) => {
    if (!spawnSpec) {
      workerStartPromise = null;
      reject(
        new Error(
          "No se pudo iniciar el procesador de preview. " +
            "En desarrollo instale Python 3; en la app instalada, reinstale Beru.",
        ),
      );
      return;
    }
    const media = validateMediaBinaries();
    const mediaOpts = media.ok
      ? { ffmpegPath: media.ffmpegPath, ffprobePath: media.ffprobePath }
      : {};
    const proc = spawn(spawnSpec.command, spawnSpec.args, {
      windowsHide: true,
      env: buildProcessorChildEnv(process.env, mediaOpts),
    });

    worker = proc;
    workerReady = false;
    let stdoutBuffer = "";
    let stderrTail = "";
    let startupSettled = false;

    const startupTimer = setTimeout(() => {
      if (startupSettled) return;
      startupSettled = true;
      workerStartPromise = null;
      try {
        proc.kill();
      } catch {}
      reject(new Error("Timeout al iniciar el preview"));
    }, STARTUP_TIMEOUT_MS);

    const failStartup = (message) => {
      if (startupSettled) return;
      startupSettled = true;
      clearTimeout(startupTimer);
      workerStartPromise = null;
      reject(new Error(message));
    };

    proc.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || "";

      for (const line of lines) {
        const message = parseWorkerLine(line);
        if (!message) continue;

        if (message.type === "ready") {
          if (!message.ok) {
            failStartup(message.error || "No se pudo iniciar el preview");
            continue;
          }
          if (!startupSettled) {
            startupSettled = true;
            clearTimeout(startupTimer);
            workerReady = true;
            resolve(proc);
          }
          continue;
        }

        if (Number.isInteger(message.id)) {
          const { id, ...result } = message;
          settleRequest(id, result);
        }
      }
    });

    proc.stderr.on("data", (chunk) => {
      stderrTail += chunk.toString();
      if (stderrTail.length > 4000) stderrTail = stderrTail.slice(-4000);
    });

    proc.on("error", (err) => {
      failStartup(err.message);
      settleWorkerRequests(proc, { ok: false, error: err.message });
    });

    // proc.on("error") covers spawn, not stdin. A dead worker emits EPIPE on
    // stdin; unhandled, that becomes an uncaughtException and kills Electron.
    proc.stdin?.on("error", (err) => {
      failStartup(`Preview worker stdin error: ${err.message}`);
      settleWorkerRequests(proc, { ok: false, error: "Preview worker se cerró" });
    });

    proc.on("close", (code) => {
      const message = stderrTail.trim() || `Preview worker finalizó (exit ${code ?? "?"})`;
      failStartup(message);
      if (worker === proc) {
        worker = null;
        workerReady = false;
        workerStartPromise = null;
      }
      settleWorkerRequests(proc, { ok: false, error: message });
    });
  });

  return workerStartPromise;
}

export async function renderPreviewFrame(payload) {
  const processorCheck = await validateProcessorAvailableAsync();
  if (!processorCheck.ok) {
    return { ok: false, error: processorCheck.error };
  }

  let proc;
  try {
    const { command, args } = processorCheck;
    proc = await startWorker({
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
  const proc = worker;
  if (proc && !proc.killed) {
    void killProcessTree(proc).catch(() => {
      try {
        proc.kill();
      } catch {}
    });
  }
  worker = null;
  workerReady = false;
  workerStartPromise = null;
}
