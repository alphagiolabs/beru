import { spawn } from "child_process";
import { buildProcessorChildEnv, invalidateSystemPythonCache } from "./processor-spawn.js";
import { validateMediaBinaries } from "./paths.js";
import { createLineWorker } from "./line-worker.js";

const STARTUP_TIMEOUT_MS = 30_000;
const RUN_IDLE_TIMEOUT_MS = 5 * 60_000;
const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_STDOUT_BUFFER_CHARS = 256_000;
const MAX_STDERR_TAIL_CHARS = 48_000;

let nextRequestId = 1;
let activeRun = null;
let stderrTailAtRunEnd = "";

function settleActiveRun(outcome) {
  const run = activeRun;
  if (!run) return;
  clearTimeout(run.timer);
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
    const proc = spawn(spawnSpec.command, [...spawnSpec.args, "--job-worker"], {
      windowsHide: true,
      env: buildProcessorChildEnv(process.env, mediaOpts),
    });
    proc.once("error", invalidateSystemPythonCache);
    return proc;
  },
  onMessage: (msg, line, proc) => {
    if (msg && msg.type === "run_end" && activeRun?.proc === proc) {
      if (msg.id != null && msg.id !== activeRun.id) {
        console.error("[beru] Job worker returned an obsolete request id:", msg.id);
        return;
      }
      stderrTailAtRunEnd = lineWorker.stderrTail();
      const valid = msg.id === activeRun.id && typeof msg.ok === "boolean";
      settleActiveRun({
        ok: valid && msg.ok === true,
        error: msg.error || (valid ? undefined : "Respuesta inválida del motor de procesamiento"),
      });
      return;
    }

    if (
      activeRun?.proc === proc &&
      ["progress", "job_progress", "complete", "error", "cancelled", "summary"].includes(msg?.type)
    ) {
      activeRun.timer.refresh();
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
  activeRun = {
    id,
    proc,
    resolve: resolveDone,
    onLine,
    timer: setTimeout(() => {
      if (activeRun?.id === id)
        lineWorker.stop(proc, {
          died: true,
          error: "El motor de procesamiento dejó de responder durante 5 minutos",
        });
    }, RUN_IDLE_TIMEOUT_MS),
  };

  try {
    const sent = lineWorker.send(
      proc,
      { id, jobs_file: jobsFile, env: env || {} },
      {
        maxBytes: MAX_REQUEST_BYTES,
        onWriteError: (err) => {
          if (activeRun?.id === id)
            settleActiveRun({ died: true, error: `Job worker stdin error: ${err.message}` });
        },
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
