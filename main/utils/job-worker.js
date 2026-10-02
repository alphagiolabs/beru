import { spawn } from "child_process";
import { buildProcessorChildEnv } from "./processor-spawn.js";
import { validateMediaBinaries } from "./paths.js";
import { createLineWorker } from "./line-worker.js";

const STARTUP_TIMEOUT_MS = 30_000;
const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_STDOUT_BUFFER_CHARS = 256_000;
const MAX_STDERR_TAIL_CHARS = 48_000;

let nextRequestId = 1;
let activeRun = null;
let stderrTailAtRunEnd = "";

function settleActiveRun(outcome) {
  const run = activeRun;
  if (!run) return;
  activeRun = null;
  run.resolve(outcome);
}

function dispatchRunLine(line, proc) {
  const run = activeRun;
  if (run && run.proc === proc && typeof run.onLine === "function") run.onLine(line);
}

const lineWorker = createLineWorker({
  name: "Job worker",
  startupTimeoutMs: STARTUP_TIMEOUT_MS,
  startupTimeoutMessage: "Timeout al iniciar el motor de procesamiento",
  startupFailedMessage: "No se pudo iniciar el motor de procesamiento",
  overflowError: "El motor de procesamiento se detuvo",
  maxPendingLineBytes: MAX_STDOUT_BUFFER_CHARS,
  stderrTailChars: MAX_STDERR_TAIL_CHARS,
  stderrLogTag: "processor",
  spawnProc: (spawnSpec) => {
    const media = validateMediaBinaries();
    const mediaOpts = media.ok
      ? { ffmpegPath: media.ffmpegPath, ffprobePath: media.ffprobePath }
      : {};
    return spawn(spawnSpec.command, [...spawnSpec.args, "--job-worker"], {
      windowsHide: true,
      env: buildProcessorChildEnv(process.env, mediaOpts),
    });
  },
  onMessage: (msg, line, proc) => {
    if (msg && msg.type === "run_end" && activeRun?.proc === proc) {
      stderrTailAtRunEnd = lineWorker.stderrTail();
      settleActiveRun({ ok: msg.ok !== false, error: msg.error });
      return;
    }

    dispatchRunLine(line, proc);
  },
  onFlushRemainder: dispatchRunLine,
  onStopped: (proc, outcome) => {
    if (activeRun?.proc === proc) settleActiveRun(outcome);
  },
  outcomeFor: (cause, { code, error }) =>
    cause === "close" || cause === "error"
      ? { died: true, code, error }
      : { died: true, error: "El motor de procesamiento se detuvo" },
});

export async function startJobRun({ spawnSpec, jobsFile, env, onLine, signal, onReady }) {
  if (signal?.aborted) return null;
  if (activeRun) {
    throw new Error("El motor de procesamiento está ocupado");
  }
  let onAbort;
  let proc;
  try {
    const ready = lineWorker.ensure(spawnSpec);
    proc = signal
      ? await Promise.race([
          ready,
          new Promise((resolve) => {
            onAbort = () => resolve(null);
            signal.addEventListener("abort", onAbort, { once: true });
            if (signal.aborted) onAbort();
          }),
        ])
      : await ready;
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
  if (!proc || signal?.aborted) return null;
  if (activeRun) throw new Error("El motor de procesamiento está ocupado");
  if (!lineWorker.isUsable(proc)) throw new Error("El motor de procesamiento se detuvo");
  onReady?.(proc);
  if (signal?.aborted) return null;
  const id = nextRequestId++;
  lineWorker.clearStderrTail();
  stderrTailAtRunEnd = "";
  let resolveDone;
  const done = new Promise((resolve) => {
    resolveDone = resolve;
  });
  activeRun = { proc, resolve: resolveDone, onLine };

  try {
    const sent = lineWorker.send(
      proc,
      { id, jobs_file: jobsFile, env: env || {} },
      {
        maxBytes: MAX_REQUEST_BYTES,
        onWriteError: (err) =>
          settleActiveRun({ died: true, error: `Job worker stdin error: ${err.message}` }),
      },
    );
    if (!sent) {
      settleActiveRun({ ok: false, error: "La solicitud de procesamiento supera el límite" });
    }
  } catch (err) {
    settleActiveRun({ died: true, error: err.message });
  }
  return { proc, done, stderrTail: () => stderrTailAtRunEnd || lineWorker.stderrTail() };
}

export function disposeJobWorker() {
  settleActiveRun({ died: true, error: "Motor de procesamiento cerrado" });
  lineWorker.dispose({ died: true, error: "Motor de procesamiento cerrado" });
}
