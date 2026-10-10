import { killProcessTree } from "./kill-process-tree.js";

export function createLineWorker({
  name,
  spawnProc,
  startupTimeoutMs,
  startupTimeoutMessage,
  startupFailedMessage,
  overflowError,
  maxPendingLineBytes,
  stderrTailChars = 4000,
  stderrLogTag = null,
  onMessage,
  onFlushRemainder,
  onStopped,
  outcomeFor,
}) {
  let worker = null;
  let workerReady = false;
  let workerStartPromise = null;
  let stdoutBuffer = "";
  let stderrTail = "";

  function killWorker(proc) {
    void killProcessTree(proc).catch(() => {
      try {
        proc.kill();
      } catch (err) {
        console.error(`[beru] ${name} termination failed:`, err.message);
      }
    });
  }

  function forget(proc) {
    if (worker !== proc) return;
    worker = null;
    workerReady = false;
    workerStartPromise = null;
  }

  function flushRemainder(proc) {
    const rest = stdoutBuffer;
    stdoutBuffer = "";
    if (rest.trim() && onFlushRemainder) {
      try {
        onFlushRemainder(rest, proc);
      } catch (err) {
        console.error(`[beru] ${name} output consumer failed:`, err.message);
      }
    }
  }

  function emitStopped(proc, cause, detail = {}) {
    onStopped?.(proc, outcomeFor(cause, detail));
  }

  function stop(proc, outcome) {
    if (worker !== proc) return;
    forget(proc);
    flushRemainder(proc);
    onStopped?.(proc, outcome ?? outcomeFor("stopped", {}));
    killWorker(proc);
  }

  function send(proc, payload, { maxBytes, onWriteError } = {}) {
    const line = `${JSON.stringify(payload)}\n`;
    if (maxBytes && Buffer.byteLength(line) > maxBytes) return false;
    proc.stdin.write(line, (err) => {
      if (err) onWriteError?.(err);
    });
    return true;
  }

  function ensure(spawnArgs) {
    if (worker && workerReady && !worker.killed) return Promise.resolve(worker);
    if (workerStartPromise) return workerStartPromise;

    let proc;
    try {
      proc = spawnProc(spawnArgs);
    } catch (err) {
      return Promise.reject(err);
    }

    workerStartPromise = new Promise((resolve, reject) => {
      worker = proc;
      workerReady = false;
      stdoutBuffer = "";
      stderrTail = "";
      let startupSettled = false;

      const failStartup = (message) => {
        if (startupSettled) return;
        startupSettled = true;
        clearTimeout(startupTimer);
        workerStartPromise = null;
        reject(new Error(message));
      };

      const handleLine = (line) => {
        let msg = null;
        try {
          msg = JSON.parse(line);
        } catch (err) {
          console.error(`[beru] ${name} returned invalid JSON:`, err.message);
        }

        if (msg && msg.type === "ready") {
          if (!msg.ok) {
            const message = msg.error || startupFailedMessage;
            failStartup(message);
            stop(proc, outcomeFor("ready-failed", { error: message }));
            return;
          }
          if (!startupSettled) {
            startupSettled = true;
            clearTimeout(startupTimer);
            workerReady = true;
            resolve(proc);
          }
          return;
        }

        try {
          onMessage?.(msg, line, proc);
        } catch (err) {
          console.error(`[beru] ${name} message consumer failed:`, err.message);
        }
      };

      const startupTimer = setTimeout(() => {
        if (startupSettled) return;
        failStartup(startupTimeoutMessage);
        stop(proc, outcomeFor("timeout", { error: startupTimeoutMessage }));
      }, startupTimeoutMs);

      const overflowStop = () => {
        if (overflowError) failStartup(overflowError);
        stop(proc, outcomeFor("overflow", { error: overflowError }));
      };

      proc.stdout.on("data", (chunk) => {
        if (worker !== proc) return;
        stdoutBuffer += chunk.toString();
        let idx;
        while ((idx = stdoutBuffer.indexOf("\n")) >= 0) {
          const rawLine = stdoutBuffer.slice(0, idx);
          if (Buffer.byteLength(rawLine) > maxPendingLineBytes) {
            stdoutBuffer = "";
            overflowStop();
            return;
          }
          stdoutBuffer = stdoutBuffer.slice(idx + 1);
          const line = rawLine.replace(/\r$/, "");
          if (line) handleLine(line);
        }
        if (Buffer.byteLength(stdoutBuffer) > maxPendingLineBytes) overflowStop();
      });

      proc.stderr.on("data", (chunk) => {
        if (worker !== proc) return;
        const text = chunk.toString();
        stderrTail = (stderrTail + text).slice(-stderrTailChars);
        if (stderrLogTag && text.trim()) console.error(`[beru][${stderrLogTag}]`, text.trim());
      });

      proc.on("error", (err) => {
        failStartup(err.message);
        const wasCurrent = worker === proc;
        forget(proc);
        if (wasCurrent) flushRemainder(proc);
        emitStopped(proc, "error", { error: err.message });
      });

      proc.stdin?.on("error", (err) => {
        failStartup(`${name} stdin error: ${err.message}`);
        stop(proc, outcomeFor("stdin", {}));
      });

      proc.on("close", (code) => {
        const message = stderrTail.trim() || `${name} finalizó (exit ${code ?? "?"})`;
        failStartup(message);
        const wasCurrent = worker === proc;
        forget(proc);
        if (wasCurrent) flushRemainder(proc);
        emitStopped(proc, "close", { code, error: message });
      });
    });

    return workerStartPromise;
  }

  return {
    ensure,
    send,
    stop,
    dispose: (outcome) => {
      if (worker) stop(worker, outcome);
    },
    current: () => worker,
    isUsable: (proc) => worker === proc && workerReady && !proc.killed,
    stderrTail: () => stderrTail,
    clearStderrTail: () => {
      stderrTail = "";
    },
  };
}
