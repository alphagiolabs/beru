import { spawn } from "child_process";

export function runCapturedProcess(command, args, options = {}) {
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
    let abortError;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (killTimer) clearTimeout(killTimer);
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

    const captureChunk = (chunk, isStdout) => {
      if (settled) return;
      const limit = isStdout ? maxStdoutBytes : maxStderrBytes;
      const used = isStdout ? stdoutBytes : stderrBytes;
      if (!truncateOnLimit && used + chunk.length > limit) {
        try {
          proc.kill();
        } catch {}
        finish({ code: null, outputExceeded: true });
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
      finish(abortError ? { code, error: abortError, cancelled: true } : { code }),
    );
    proc.on("error", (error) => {
      if (error.name === "AbortError") abortError = error;
      else finish({ code: null, error });
    });
    killTimer = setTimeout(() => {
      try {
        proc.kill();
      } catch {}
      finish({ code: null, timedOut: true });
    }, timeoutMs);
  });
}
