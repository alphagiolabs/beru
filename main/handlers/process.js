import { ipcMain, dialog } from "electron";
import { spawn, execFile } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { randomBytes } from "crypto";
import { app } from "electron";
import {
  getMainWindow,
  getPythonProcess,
  setPythonProcess,
  getCurrentTmpFile,
  setCurrentTmpFile,
  getIsProcessing,
  beginProcessingRun,
  clearProcessingRun,
  getProcessingRunId,
  getLastProcessingError,
  setLastProcessingError,
} from "../shared-state.js";
import { getPythonPath, getFfmpegPath, getFfprobePath } from "../utils/paths.js";
import { probeVideo } from "../utils/video-cache.js";
import { readSettings } from "../utils/settings.js";
import { sendToRenderer } from "../utils/renderer.js";
import { runWithConcurrency } from "../utils/concurrency.js";
import { createProcessorManifest, unwrapJobManifest } from "../utils/jobManifest.js";

const MAX_PROCESSOR_STDERR_CHARS = 48_000;
const MAX_PROCESSOR_STDOUT_LINE_CHARS = 256_000;

function appendBoundedText(current, chunk, maxChars) {
  const next = `${current || ""}${chunk || ""}`;
  return next.length > maxChars ? next.slice(-maxChars) : next;
}

function resolvePythonSpawn() {
  if (process.env.BERU_PYTHON && fs.existsSync(process.env.BERU_PYTHON)) {
    return { command: process.env.BERU_PYTHON, args: [] };
  }
  if (process.platform === "win32") {
    return { command: "py", args: ["-3"] };
  }
  return { command: "python3", args: [] };
}

function dispatchProcessorLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const msg = JSON.parse(trimmed);
    if (msg.type === "progress") sendToRenderer("process:progress", msg);
    else if (msg.type === "job_progress") sendToRenderer("process:jobProgress", msg);
    else if (msg.type === "complete") sendToRenderer("process:complete", msg);
    else if (msg.type === "error") {
      const errText = msg.error || msg.message || "Unknown error";
      const idx = msg.index;
      if (Number.isInteger(idx) && idx >= 0) {
        sendToRenderer("process:jobError", msg);
      } else {
        setLastProcessingError(errText);
        sendToRenderer("process:error", errText);
      }
    } else if (msg.type === "summary") sendToRenderer("process:summary", msg);
    else sendToRenderer("process:log", trimmed);
  } catch {
    sendToRenderer("process:log", trimmed);
  }
}

function waitForProcessClose(proc, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const onClose = () => {
      clearTimeout(timeout);
      resolve(true);
    };
    const timeout = setTimeout(() => {
      proc.removeListener("close", onClose);
      resolve(false);
    }, timeoutMs);
    proc.once("close", onClose);
    if (proc.exitCode !== null) {
      clearTimeout(timeout);
      proc.removeListener("close", onClose);
      resolve(true);
    }
  });
}

function killProcessTree(proc) {
  if (!proc?.pid) return;
  if (process.platform === "win32") {
    execFile("taskkill", ["/F", "/T", "/PID", String(proc.pid)], { windowsHide: true }, (err) => {
      if (err) console.error("[beru] taskkill error:", err.message);
    });
    return;
  }
  proc.kill("SIGTERM");
}

function hasVideoOperations(job) {
  return Array.isArray(job?.operations) && job.operations.length > 0;
}

function hasJobDimensions(job) {
  return (
    Number(job?.source_width || job?.width || 0) > 0 &&
    Number(job?.source_height || job?.height || 0) > 0
  );
}

function hasExportMetadata(job) {
  return (
    hasJobDimensions(job) &&
    Number(job?.video_duration || 0) > 0 &&
    String(job?.pix_fmt || "").trim().length > 0
  );
}

function applyProbeInfoToJob(job, info) {
  const sw = Number(job.source_width || job.width || info?.width || 0);
  const sh = Number(job.source_height || job.height || info?.height || 0);
  return {
    ...job,
    width: sw,
    height: sh,
    source_width: sw,
    source_height: sh,
    video_duration: info?.duration || job.video_duration || 0,
    video_codec: info?.videoCodec || job.video_codec || "",
    pix_fmt: info?.pixFmt || job.pix_fmt || "yuv420p",
    frame_rate: info?.frameRate || job.frame_rate || 0,
    audio_codec: info?.audioCodec || job.audio_codec || "",
    audio_channels: info?.audioChannels || job.audio_channels || 0,
  };
}

async function enrichJobVideoInfo(job) {
  if (!hasVideoOperations(job)) return job;

  const sw = Number(job.source_width || job.width || 0);
  const sh = Number(job.source_height || job.height || 0);
  if (hasExportMetadata(job)) {
    return {
      ...job,
      width: sw,
      height: sh,
      source_width: sw,
      source_height: sh,
    };
  }

  if (!job?.input_path) return job;
  try {
    const info = await probeVideo(job.input_path);
    if (info.width > 0 && info.height > 0) {
      return applyProbeInfoToJob(job, info);
    }
  } catch (e) {
    console.error("[beru] Job probe failed:", job.input_path, e.message);
  }

  if (sw > 0 && sh > 0) {
    return {
      ...job,
      width: sw,
      height: sh,
      source_width: sw,
      source_height: sh,
    };
  }
  return job;
}

export async function cancelActiveProcessing() {
  const runId = getProcessingRunId();
  const currentTmp = getCurrentTmpFile();
  if (currentTmp) {
    const cancelFile = currentTmp.replace(".json", ".cancel");
    try {
      fs.writeFileSync(cancelFile, "1");
    } catch {}
  }

  const proc = getPythonProcess();
  if (proc?.pid) {
    const deathPromise = waitForProcessClose(proc);
    killProcessTree(proc);
    await deathPromise;
  }

  setPythonProcess(null);
  clearProcessingRun(runId);
  if (currentTmp) {
    try {
      fs.unlinkSync(currentTmp);
    } catch {}
    try {
      fs.unlinkSync(currentTmp.replace(".json", ".cancel"));
    } catch {}
    if (getCurrentTmpFile() === currentTmp) setCurrentTmpFile(null);
  }
}

export function registerProcessHandlers(pathSecurity) {
  ipcMain.handle("process:start", async (_event, payload) => {
    const { jobs, manifest, error } = unwrapJobManifest(payload);
    if (error) {
      return { success: false, error };
    }
    if (!Array.isArray(jobs) || jobs.length === 0) {
      return { success: false, error: "No hay videos para procesar" };
    }

    const scriptPath = getPythonPath();
    if (!fs.existsSync(scriptPath)) {
      return { success: false, error: "processor.py not found" };
    }

    const runId = `${Date.now()}-${randomBytes(4).toString("hex")}`;
    if (!beginProcessingRun(runId)) {
      return { success: false, error: "Ya hay un proceso en ejecución" };
    }

    let tmpFile = null;
    let cancelFile = null;

    try {
      for (const job of jobs) {
        if (job?.input_path) pathSecurity.registerAllowedPath(job.input_path);
      }

      setLastProcessingError(null);

      tmpFile = path.join(app.getPath("temp"), `beru-jobs-${runId}.json`);
      setCurrentTmpFile(tmpFile);
      cancelFile = tmpFile.replace(".json", ".cancel");
      try {
        fs.unlinkSync(cancelFile);
      } catch {}
      const probeLimit = Math.max(1, Math.min(8, jobs.length, (os.cpus()?.length || 4) * 2));
      const enrichedJobs = await runWithConcurrency(jobs, probeLimit, enrichJobVideoInfo);

      await fs.promises.writeFile(
        tmpFile,
        JSON.stringify(createProcessorManifest(manifest, enrichedJobs)),
      );

      const firstProfile = enrichedJobs[0]?.encode_profile || "balanced";
      const settings = readSettings();
      const batchWorkersMode =
        settings.batchWorkersMode === "conservative" ? "conservative" : "balanced";
      let workerCount = "0";
      if (Number(settings.batchWorkers) > 0) {
        workerCount = String(Math.min(16, Math.floor(Number(settings.batchWorkers))));
      }

      const py = resolvePythonSpawn();
      const ffmpegPath = getFfmpegPath();
      const ffprobePath = getFfprobePath();
      const childEnv = {
        ...process.env,
        BERU_WORKERS: workerCount,
        BERU_WORKERS_MODE: batchWorkersMode,
        BERU_RETRY_FAILED: settings.batchRetryFailed === false ? "0" : "1",
        BERU_ENCODE_PROFILE: firstProfile,
      };
      if (ffmpegPath) childEnv.BERU_FFMPEG = ffmpegPath;
      if (ffprobePath) childEnv.BERU_FFPROBE = ffprobePath;
      const proc = spawn(py.command, [...py.args, scriptPath, tmpFile], {
        windowsHide: true,
        env: childEnv,
      });
      setPythonProcess(proc);

      let stdoutBuf = "";
      let stderrBuf = "";
      let settled = false;
      const isCurrentRun = () => getProcessingRunId() === runId;

      // Capture tmpFile in closure so this run always cleans up its own file,
      // even if a new run overwrites the shared _currentTmpFile.
      const runTmpFile = tmpFile;
      const runCancelFile = cancelFile;

      const cleanupRunArtifacts = () => {
        try {
          if (runTmpFile) fs.unlinkSync(runTmpFile);
        } catch {}
        try {
          if (runCancelFile) fs.unlinkSync(runCancelFile);
        } catch {}
      };

      let resolveClose = null;
      let resolveError = null;

      const cleanupChildListeners = () => {
        proc.stdout?.removeListener("data", onStdoutData);
        proc.stderr?.removeListener("data", onStderrData);
        if (resolveClose) proc.removeListener("close", resolveClose);
        if (resolveError) proc.removeListener("error", resolveError);
      };

      const settleRun = (result) => {
        if (settled) return result;
        settled = true;
        cleanupChildListeners();
        if (!isCurrentRun()) {
          cleanupRunArtifacts();
          return result;
        }
        setPythonProcess(null);
        clearProcessingRun(runId);
        cleanupRunArtifacts();
        if (getCurrentTmpFile() === runTmpFile) setCurrentTmpFile(null);
        return result;
      };

      const onStdoutData = (data) => {
        if (!isCurrentRun()) return;
        stdoutBuf = appendBoundedText(stdoutBuf, data.toString(), MAX_PROCESSOR_STDOUT_LINE_CHARS);
        const lines = stdoutBuf.split("\n");
        stdoutBuf = lines.pop() || "";
        for (const line of lines) dispatchProcessorLine(line);
      };

      const onStderrData = (data) => {
        if (!isCurrentRun()) return;
        const text = data.toString();
        stderrBuf = appendBoundedText(stderrBuf, text, MAX_PROCESSOR_STDERR_CHARS);
        if (text.trim()) console.error("[beru][processor]", text.trim());
      };

      const onClose = (code) => {
        if (!isCurrentRun()) {
          return settleRun({
            success: false,
            code,
            error: "Processing superseded",
            superseded: true,
          });
        }
        if (stdoutBuf.trim()) dispatchProcessorLine(stdoutBuf);
        sendToRenderer("process:finished", { code });
        const failed = code !== 0;
        let errMsg;
        if (failed) {
          errMsg = getLastProcessingError();
          if (!errMsg && stderrBuf.trim()) {
            const snippet = stderrBuf.trim().slice(-300);
            errMsg = `Process exited with code ${code}: ${snippet}`;
            setLastProcessingError(errMsg);
          } else {
            errMsg = errMsg || `Process exited with code ${code}`;
          }
        }
        return settleRun({
          success: !failed,
          code,
          error: failed ? errMsg : undefined,
        });
      };

      const onError = (err) => {
        if (isCurrentRun()) {
          setLastProcessingError(err.message);
          sendToRenderer("process:error", err.message);
        }
        return settleRun({ success: false, code: 1, error: err.message });
      };

      proc.stdout.on("data", onStdoutData);
      proc.stderr.on("data", onStderrData);

      return new Promise((resolve) => {
        resolveClose = (code) => resolve(onClose(code));
        resolveError = (err) => resolve(onError(err));
        proc.once("close", resolveClose);
        proc.once("error", resolveError);
      });
    } catch (err) {
      if (getProcessingRunId() === runId) {
        clearProcessingRun(runId);
        setPythonProcess(null);
        setCurrentTmpFile(null);
      }
      if (tmpFile) {
        try {
          fs.unlinkSync(tmpFile);
        } catch {}
      }
      if (cancelFile) {
        try {
          fs.unlinkSync(cancelFile);
        } catch {}
      }
      console.error("[beru] process:start failed:", err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("process:cancel", async () => {
    await cancelActiveProcessing();
    return { success: true };
  });

  ipcMain.handle("process:exportLogs", async (_event, text) => {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const res = await dialog.showSaveDialog({
      title: "Exportar logs de procesamiento",
      defaultPath: path.join(app.getPath("documents"), `beru-processing-${stamp}.txt`),
      filters: [{ name: "Text", extensions: ["txt"] }],
    });
    if (res.canceled || !res.filePath) return { success: false, canceled: true };
    await fs.promises.writeFile(res.filePath, String(text || ""), "utf8");
    return { success: true, filePath: res.filePath };
  });
}
