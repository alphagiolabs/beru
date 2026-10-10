import { spawn } from "child_process";
import path from "path";
import { killProcessTree } from "./kill-process-tree.js";

export async function runCapturedProcess(command, args, options = {}) {
  if (process.versions.electron && /^(ffmpeg|ffprobe)(\.exe)?$/i.test(path.basename(command))) {
    if (options.spawnOptions?.signal?.aborted) {
      return {
        code: null,
        stdout: options.stdoutMode === "buffer" ? Buffer.alloc(0) : "",
        stderr: "",
        cancelled: true,
      };
    }
    try {
      const { resolveProcessorSpawnAsync } = await import("./processor-spawn.js");
      const spec = await resolveProcessorSpawnAsync(["--run-media", command, ...args]);
      if (!spec) throw new Error("No se encontró el motor para ejecutar los procesos de medios");
      return captureProcess(spec.command, spec.args, {
        ...options,
        spawnOptions: {
          ...options.spawnOptions,
          env: {
            ...(options.spawnOptions?.env || process.env),
            BERU_PARENT_PID: String(process.pid),
            PYTHONIOENCODING: "utf-8",
            PYTHONUTF8: "1",
          },
        },
      });
    } catch (error) {
      return { code: null, stdout: "", stderr: "", error };
    }
  }
  return captureProcess(command, args, options);
}

function captureProcess(command, args, options) {
  const {
    timeoutMs = 5000,
    maxStdoutBytes = Infinity,
    maxStderrBytes = Infinity,
    stdoutMode = "text",
    stderrMode = "text",
    truncateOnLimit = false,
    capture = true,
    spawnOptions = {},
  } = options;

  if (spawnOptions.signal?.aborted) {
    return Promise.resolve({
      code: null,
      stdout: stdoutMode === "buffer" ? Buffer.alloc(0) : "",
      stderr: "",
      cancelled: true,
    });
  }

  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(command, args, {
        windowsHide: true,
        ...(capture ? {} : { stdio: "ignore" }),
        ...spawnOptions,
      });
    } catch (error) {
      resolve({ code: null, stdout: "", stderr: "", error });
      return;
    }

    const stdoutChunks = [];
    const stderrChunks = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let killTimer = null;
    let closeTimer = null;
    let stopping = null;
    let abortError;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (killTimer) clearTimeout(killTimer);
      if (closeTimer) clearTimeout(closeTimer);
      proc.stdout?.removeAllListeners("data");
      proc.stderr?.removeAllListeners("data");
      const stdout =
        stdoutMode === "buffer"
          ? Buffer.concat(stdoutChunks)
          : stdoutMode === "text"
            ? stdoutChunks.join("")
            : "";
      resolve({ stdout, stderr: stderrChunks.join(""), ...result });
    };

    const stop = (result) => {
      if (settled || stopping) return;
      stopping = result;
      clearTimeout(killTimer);
      try {
        proc.kill();
      } catch (error) {
        console.error("[beru] captured process termination failed:", error.message);
      }
      closeTimer = setTimeout(() => {
        void killProcessTree(proc).catch((error) => {
          console.error("[beru] captured process tree termination failed:", error.message);
        });
        closeTimer = setTimeout(() => {
          finish({
            ...stopping,
            terminationFailed: true,
            error: new Error("No se pudo confirmar el cierre del proceso de medios"),
          });
        }, 5000);
      }, 2000);
    };

    const captureChunk = (chunk, isStdout) => {
      if (settled || stopping) return;
      const limit = isStdout ? maxStdoutBytes : maxStderrBytes;
      const used = isStdout ? stdoutBytes : stderrBytes;
      if (!truncateOnLimit && used + chunk.length > limit) {
        stop({ code: null, outputExceeded: true });
        return;
      }
      const room = Math.max(0, limit - used);
      const kept = truncateOnLimit ? chunk.subarray(0, room) : chunk;
      if (isStdout) {
        stdoutBytes += kept.length;
        if (stdoutMode === "buffer") stdoutChunks.push(Buffer.from(kept));
        else if (stdoutMode === "text") stdoutChunks.push(kept.toString());
      } else {
        stderrBytes += kept.length;
        if (stderrMode === "text") stderrChunks.push(kept.toString());
      }
    };

    if (capture) {
      proc.stdout?.on("data", (chunk) => captureChunk(chunk, true));
      proc.stderr?.on("data", (chunk) => captureChunk(chunk, false));
    }

    proc.on("close", (code) =>
      finish(abortError ? { code, error: abortError, cancelled: true } : stopping || { code }),
    );
    proc.on("error", (error) => {
      if (error.name === "AbortError") abortError = error;
      else if (proc.pid) stop({ code: null, error });
      else finish({ code: null, error });
    });
    killTimer = setTimeout(() => {
      stop({ code: null, timedOut: true });
    }, timeoutMs);
  });
}
