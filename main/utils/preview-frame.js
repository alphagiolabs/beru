import { spawn } from "child_process";
import fs from "fs";
import { getPythonPath } from "./paths.js";

const STARTUP_TIMEOUT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 60_000;

let worker = null;
let workerStartPromise = null;
let workerReady = false;
let nextRequestId = 1;
const pending = new Map();

function resolvePythonSpawn() {
  if (process.env.BERU_PYTHON && fs.existsSync(process.env.BERU_PYTHON)) {
    return { command: process.env.BERU_PYTHON, args: [] };
  }
  if (process.platform === "win32") {
    return { command: "py", args: ["-3"] };
  }
  return { command: "python3", args: [] };
}

function settleRequest(id, result) {
  const request = pending.get(id);
  if (!request) return;
  pending.delete(id);
  clearTimeout(request.timer);
  request.resolve(result);
}

function settleAll(result) {
  for (const id of pending.keys()) settleRequest(id, result);
}

function settleWorkerRequests(proc, result) {
  for (const [id, request] of pending) {
    if (request.proc === proc) settleRequest(id, result);
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

function startWorker(pythonScript) {
  if (worker && workerReady && !worker.killed) return Promise.resolve(worker);
  if (workerStartPromise) return workerStartPromise;

  workerStartPromise = new Promise((resolve, reject) => {
    const { command, args: pyArgs } = resolvePythonSpawn();
    const proc = spawn(command, [...pyArgs, pythonScript, "--preview-frame-worker"], {
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
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
  const pythonScript = getPythonPath();
  if (!pythonScript || !fs.existsSync(pythonScript)) {
    return { ok: false, error: "Procesador Python no encontrado" };
  }

  let proc;
  try {
    proc = await startWorker(pythonScript);
  } catch (err) {
    return { ok: false, error: err.message };
  }

  return new Promise((resolve) => {
    const id = nextRequestId++;
    const timer = setTimeout(() => {
      settleRequest(id, { ok: false, error: "Timeout al renderizar el frame" });
      if (worker === proc) {
        try {
          proc.kill();
        } catch {}
      }
    }, REQUEST_TIMEOUT_MS);

    pending.set(id, { resolve, timer, proc });
    proc.stdin.write(`${JSON.stringify({ id, payload })}\n`, (err) => {
      if (!err) return;
      settleRequest(id, { ok: false, error: err.message });
      if (worker === proc) {
        try {
          proc.kill();
        } catch {}
      }
    });
  });
}

export function disposePreviewFrameWorker() {
  settleAll({ ok: false, cancelled: true, error: "Preview cancelado" });
  const proc = worker;
  worker = null;
  workerReady = false;
  workerStartPromise = null;
  if (proc && !proc.killed) {
    try {
      proc.kill();
    } catch {}
  }
}
