import { ipcMain, dialog, app } from "electron";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { randomBytes } from "crypto";
import { getAppIsQuitting } from "../shared-state.js";
import {
  getPythonProcess,
  setPythonProcess,
  getCurrentTmpFile,
  setCurrentTmpFile,
  beginProcessingRun,
  clearProcessingRun,
  getProcessingRunId,
  getCancellingRunId,
  setCancellingRunId,
  clearCancellingRunId,
  setProbePhaseActive,
  getLastProcessingError,
  setLastProcessingError,
  snapshotRunOutputsForCancel,
  markJobOutputComplete,
  clearRunOutputSnapshot,
  cleanupIncompleteOutputsAfterCancel,
} from "../processing-run.js";
import { validateMediaBinaries } from "../utils/paths.js";
import {
  validateProcessorAvailableAsync,
  buildProcessorChildEnv,
} from "../utils/processor-spawn.js";
import { killProcessTree } from "../utils/kill-process-tree.js";
import { probeVideo } from "../utils/video-cache.js";
import { readSettings } from "../utils/settings.js";
import { sendToRenderer } from "../utils/renderer.js";
import { runWithConcurrency } from "../utils/concurrency.js";
import { createProcessorManifest, unwrapJobManifest } from "../utils/jobManifest.js";
import {
  findUnreadableInputsAsync,
  translateProcessorErrorMessage,
} from "../utils/process-input-validation.js";
import { sanitizeJobMedia } from "../utils/process-media-validation.js";

const MAX_PROCESSOR_STDERR_CHARS = 48_000;
const MAX_PROCESSOR_STDOUT_LINE_CHARS = 256_000;
const CANCEL_KILL_GRACE_MS = 1500;

function unlinkTmpArtifacts(tmpFile) {
  if (!tmpFile) return;
  try {
    fs.unlinkSync(tmpFile);
  } catch {}
  try {
    fs.unlinkSync(tmpFile.replace(".json", ".cancel"));
  } catch {}
}

function appendBoundedText(current, chunk, maxChars) {
  const next = `${current || ""}${chunk || ""}`;
  return next.length > maxChars ? next.slice(-maxChars) : next;
}

function dispatchProcessorLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const msg = JSON.parse(trimmed);
    if (msg.type === "progress") sendToRenderer("process:progress", msg);
    else if (msg.type === "job_progress") sendToRenderer("process:jobProgress", msg);
    else if (msg.type === "complete") {
      markJobOutputComplete(msg.index);
      sendToRenderer("process:complete", msg);
    } else if (msg.type === "cancelled") {
      sendToRenderer("process:jobCancelled", msg);
    } else if (msg.type === "error") {
      const errText = msg.error || "Unknown error";
      const idx = msg.index;
      if (Number.isInteger(idx) && idx >= 0) {
        if (errText === "Cancelled") {
          sendToRenderer("process:jobCancelled", { type: "cancelled", index: idx });
        } else {
          sendToRenderer("process:jobError", msg);
        }
      } else {
        const translated = translateProcessorErrorMessage(errText);
        setLastProcessingError(translated);
        sendToRenderer("process:error", {
          error: translated,
          runId: getProcessingRunId(),
        });
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

function normalizeJobDimensions(job) {
  const sw = Number(job.source_width || job.width || 0);
  const sh = Number(job.source_height || job.height || 0);
  return {
    ...job,
    width: sw,
    height: sh,
    source_width: sw,
    source_height: sh,
  };
}

async function enrichJobVideoInfo(job) {
  if (!hasVideoOperations(job)) return job;

  const sw = Number(job.source_width || job.width || 0);
  const sh = Number(job.source_height || job.height || 0);
  if (hasExportMetadata(job)) {
    return normalizeJobDimensions(job);
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
    return normalizeJobDimensions(job);
  }
  return job;
}

export async function cancelActiveProcessing() {
  const runId = getProcessingRunId();
  const proc = getPythonProcess();
  const currentTmp = getCurrentTmpFile();

  if (!runId && !proc?.pid) {
    return { success: true, idle: true };
  }

  if (runId) setCancellingRunId(runId);

  if (currentTmp) {
    const cancelFile = currentTmp.replace(".json", ".cancel");
    try {
      fs.writeFileSync(cancelFile, "1");
    } catch {}
  }

  if (proc?.pid) {
    const exitedDuringGrace = await waitForProcessClose(proc, CANCEL_KILL_GRACE_MS);
    if (!exitedDuringGrace) {
      const deathPromise = waitForProcessClose(proc);
      await killProcessTree(proc);
      const closed = await deathPromise;
      if (!closed) {
        try {
          if (process.platform === "win32") proc.kill();
          else proc.kill("SIGKILL");
        } catch (e) {
          console.error("[beru] kill escalate error:", e.message);
        }
        await waitForProcessClose(proc, 3000);
      }
    }
  }

  cleanupIncompleteOutputsAfterCancel();

  if (runId && getProcessingRunId() === runId) {
    setPythonProcess(null);
    clearProcessingRun(runId);
    if (currentTmp) {
      unlinkTmpArtifacts(currentTmp);
      if (getCurrentTmpFile() === currentTmp) setCurrentTmpFile(null);
    }
    sendToRenderer("process:finished", { code: null, cancelled: true, runId });
  } else if (!runId && getPythonProcess() === proc) {
    setPythonProcess(null);
  }

  clearCancellingRunId(runId);

  return { success: true, idle: false };
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

    const processorCheck = await validateProcessorAvailableAsync();
    if (!processorCheck.ok) {
      return { success: false, error: processorCheck.error };
    }

    const mediaCheck = validateMediaBinaries();
    if (!mediaCheck.ok) {
      return { success: false, error: mediaCheck.error };
    }

    const outputDirectory = pathSecurity.getOutputDirectory();
    if (!outputDirectory) {
      return { success: false, error: "Selecciona una carpeta de salida antes de procesar" };
    }

    let safeJobs;
    try {
      safeJobs = jobs.map((job) => sanitizeJobMedia(job, pathSecurity, { outputDirectory }));
    } catch (securityError) {
      return { success: false, error: securityError.message };
    }

    const unreadable = await findUnreadableInputsAsync(safeJobs);
    if (unreadable.length > 0) {
      const first = unreadable[0];
      return {
        success: false,
        error: first.message,
        unreadableInputs: unreadable.map((u) => ({
          path: u.inputPath,
          code: u.code,
        })),
      };
    }

    if (getAppIsQuitting()) {
      return { success: false, error: "Procesamiento cancelado", cancelled: true };
    }

    const runId = `${Date.now()}-${randomBytes(4).toString("hex")}`;
    if (!beginProcessingRun(runId)) {
      return { success: false, error: "Ya hay un proceso en ejecución" };
    }
    sendToRenderer("process:runStarted", { runId });
    setProbePhaseActive(true);

    let tmpFile = null;
    let cancelFile = null;

    try {
      setLastProcessingError(null);

      tmpFile = path.join(app.getPath("temp"), `beru-jobs-${runId}.json`);
      setCurrentTmpFile(tmpFile);
      cancelFile = tmpFile.replace(".json", ".cancel");
      try {
        fs.unlinkSync(cancelFile);
      } catch {}

      const runTmpFile = tmpFile;
      const isCurrentRun = () => getProcessingRunId() === runId;

      const cleanupRunArtifacts = () => {
        unlinkTmpArtifacts(runTmpFile);
      };

      const cleanupCancelledRun = () => {
        cleanupRunArtifacts();
        if (isCurrentRun()) {
          setProbePhaseActive(false);
          clearProcessingRun(runId);
          if (getCurrentTmpFile() === runTmpFile) setCurrentTmpFile(null);
        }
      };

      const probeLimit = Math.max(1, Math.min(8, safeJobs.length, (os.cpus()?.length || 4) * 2));
      const enrichedJobs = await runWithConcurrency(
        safeJobs,
        probeLimit,
        enrichJobVideoInfo,
        undefined,
        () => !isCurrentRun(),
      );

      if (!isCurrentRun() || getAppIsQuitting()) {
        cleanupCancelledRun();
        return { success: false, error: "Procesamiento cancelado", cancelled: true };
      }
      setProbePhaseActive(false);

      await fs.promises.writeFile(
        tmpFile,
        JSON.stringify(createProcessorManifest(manifest, enrichedJobs)),
      );

      if (!isCurrentRun() || getAppIsQuitting()) {
        cleanupCancelledRun();
        return { success: false, error: "Procesamiento cancelado", cancelled: true };
      }

      const firstProfile = enrichedJobs[0]?.encode_profile || "balanced";
      const settings = readSettings();
      const batchWorkersMode =
        settings.batchWorkersMode === "conservative" ? "conservative" : "balanced";
      let workerCount = "0";
      if (Number(settings.batchWorkers) > 0) {
        workerCount = String(Math.min(16, Math.floor(Number(settings.batchWorkers))));
      }

      const spawnSpec = {
        ...processorCheck,
        args: [...processorCheck.args, tmpFile],
      };

      const ffmpegPath = mediaCheck.ffmpegPath;
      const ffprobePath = mediaCheck.ffprobePath;
      const childEnv = buildProcessorChildEnv(
        {
          ...process.env,
          BERU_WORKERS: workerCount,
          BERU_WORKERS_MODE: batchWorkersMode,
          BERU_RETRY_FAILED: settings.batchRetryFailed === false ? "0" : "1",
          BERU_ENCODE_PROFILE: firstProfile,
        },
        { ffmpegPath, ffprobePath },
      );
      const proc = spawn(spawnSpec.command, spawnSpec.args, {
        windowsHide: true,
        env: childEnv,
      });
      setPythonProcess(proc);
      snapshotRunOutputsForCancel(enrichedJobs, outputDirectory);

      let stdoutBuf = "";
      let stderrBuf = "";
      let settled = false;

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
          if (getPythonProcess() === proc) setPythonProcess(null);
          cleanupRunArtifacts();
          if (!result?.cancelled) clearRunOutputSnapshot();
          return result;
        }
        setPythonProcess(null);
        clearProcessingRun(runId);
        cleanupRunArtifacts();
        if (getCurrentTmpFile() === runTmpFile) setCurrentTmpFile(null);
        if (!result?.cancelled) clearRunOutputSnapshot();
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
        if (settled) {
          return settleRun({
            success: false,
            code,
            error: "Processing superseded",
            superseded: true,
          });
        }

        const cancellingThisRun = getCancellingRunId() === runId;

        if (!isCurrentRun() && !cancellingThisRun) {
          return settleRun({
            success: false,
            code,
            error: "Processing superseded",
            superseded: true,
          });
        }
        if (stdoutBuf.trim()) dispatchProcessorLine(stdoutBuf);

        if (cancellingThisRun) {
          sendToRenderer("process:finished", { code: null, cancelled: true, runId });
          clearCancellingRunId(runId);
          return settleRun({ success: false, code: null, cancelled: true, runId });
        }

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
          errMsg = translateProcessorErrorMessage(errMsg);
        }
        sendToRenderer(
          "process:finished",
          failed ? { code, error: errMsg, runId } : { code, runId },
        );
        return settleRun({
          success: !failed,
          code,
          error: failed ? errMsg : undefined,
          runId,
        });
      };

      const onError = (err) => {
        if (isCurrentRun()) {
          const translated = translateProcessorErrorMessage(err.message);
          setLastProcessingError(translated);
          sendToRenderer("process:error", { error: translated, runId });
          return settleRun({ success: false, code: 1, error: translated, runId });
        }
        return settleRun({ success: false, code: 1, error: err.message, runId });
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
      unlinkTmpArtifacts(tmpFile);
      console.error("[beru] process:start failed:", err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("process:cancel", async () => {
    const result = await cancelActiveProcessing();
    return { success: true, idle: !!result?.idle };
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
