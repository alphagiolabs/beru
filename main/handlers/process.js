import { ipcMain, dialog } from "electron";
import { spawn, execFile } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { randomBytes } from "crypto";
import { app } from "electron";
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
  getAppIsQuitting,
} from "../shared-state.js";
import { validateMediaBinaries } from "../utils/paths.js";
import {
  validateProcessorAvailable,
  resolveProcessorSpawn,
  buildProcessorChildEnv,
} from "../utils/processor-spawn.js";
import { probeVideo } from "../utils/video-cache.js";
import { readSettings } from "../utils/settings.js";
import { sendToRenderer } from "../utils/renderer.js";
import { runWithConcurrency } from "../utils/concurrency.js";
import { createProcessorManifest, unwrapJobManifest } from "../utils/jobManifest.js";
import { deriveOutputPath, removeIncompleteOutput } from "../utils/process-output.js";
import {
  findUnreadableInputs,
  translateProcessorErrorMessage,
} from "../utils/process-input-validation.js";

const MAX_PROCESSOR_STDERR_CHARS = 48_000;
const MAX_PROCESSOR_STDOUT_LINE_CHARS = 256_000;
/** Cap grace before force-kill so Python can honor .cancel and clean partials. */
const CANCEL_KILL_GRACE_MS = 1500;

/**
 * Snapshot of active-run output paths (+ inputs) for cancel cleanup.
 * Populated at spawn so cleanup works even if the tmp JSON is already gone.
 * Keep-set is only type:"complete" indices (not cancelled).
 */
let activeRunOutputSnapshot = null;

function snapshotRunOutputsForCancel(jobs, outputRoot) {
  activeRunOutputSnapshot = {
    outputRoot,
    jobs: (jobs || []).map((job, index) => ({
      index,
      outputPath: job?.output_path,
      inputPath: job?.input_path,
    })),
    completedIndices: new Set(),
  };
}

function markJobOutputComplete(index) {
  if (!activeRunOutputSnapshot) return;
  if (!Number.isInteger(index) || index < 0) return;
  activeRunOutputSnapshot.completedIndices.add(index);
}

function clearRunOutputSnapshot() {
  activeRunOutputSnapshot = null;
}

function cleanupIncompleteOutputsAfterCancel() {
  const snap = activeRunOutputSnapshot;
  if (!snap) return;
  try {
    for (const job of snap.jobs) {
      if (snap.completedIndices.has(job.index)) continue;
      removeIncompleteOutput(job.outputPath, {
        outputRoot: snap.outputRoot,
        inputPath: job.inputPath,
      });
    }
  } finally {
    clearRunOutputSnapshot();
  }
}

function prepareJobsForProcessor(jobs, outputDirectory, pathSecurity) {
  return jobs.map((job) => {
    const inputCheck = pathSecurity.validateReadableFile(job?.input_path, "video");
    if (!inputCheck.ok) {
      throw new Error(`Entrada no permitida: ${inputCheck.error}`);
    }

    const assetRoots = new Set();
    const validateImage = (imagePath) => {
      if (!imagePath) return imagePath;
      const imageCheck = pathSecurity.validateReadableFile(imagePath, "image");
      if (!imageCheck.ok) {
        throw new Error(`Imagen no permitida: ${imageCheck.error}`);
      }
      assetRoots.add(path.dirname(imageCheck.resolvedPath));
      return imageCheck.resolvedPath;
    };

    const operations = (job.operations || []).map((operation) => ({
      ...operation,
      image_path: validateImage(operation.image_path),
      delogo_image_path: validateImage(operation.delogo_image_path),
    }));
    const watermark = job.watermark ? { ...job.watermark } : null;
    if (watermark?.type === "image") {
      watermark.imagePath = validateImage(watermark.imagePath || watermark.watermark_image);
    }

    return {
      ...job,
      input_path: inputCheck.resolvedPath,
      input_root: path.dirname(inputCheck.resolvedPath),
      output_path: deriveOutputPath(outputDirectory, job.output_path),
      output_root: outputDirectory,
      asset_roots: [...assetRoots],
      operations,
      watermark,
    };
  });
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
    } else if (msg.type === "error") {
      const errText = msg.error || "Unknown error";
      const idx = msg.index;
      if (Number.isInteger(idx) && idx >= 0) {
        sendToRenderer("process:jobError", msg);
      } else {
        const translated = translateProcessorErrorMessage(errText);
        setLastProcessingError(translated);
        sendToRenderer("process:error", translated);
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
  if (!proc?.pid) return Promise.resolve();
  if (process.platform === "win32") {
    return new Promise((resolve) => {
      execFile("taskkill", ["/F", "/T", "/PID", String(proc.pid)], { windowsHide: true }, (err) => {
        if (err) {
          console.error("[beru] taskkill error:", err.message);
          try {
            proc.kill();
          } catch {}
        }
        resolve();
      });
    });
  }
  try {
    proc.kill("SIGTERM");
  } catch {}
  return Promise.resolve();
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

// Normalize a job's width/height fields (used both when export metadata is
// already present and as a fallback after a failed probe).
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

  // Idle: do not emit process:finished — a spurious cancelled event can abort a
  // newly started run in the renderer (abortActiveProcessing).
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
    // Give Python a short window to see .cancel and run _cleanup_ffmpeg_partial
    // before we force-kill (which races and can leave truncated .mp4s).
    const exitedDuringGrace = await waitForProcessClose(proc, CANCEL_KILL_GRACE_MS);
    if (!exitedDuringGrace) {
      const deathPromise = waitForProcessClose(proc);
      await killProcessTree(proc);
      const closed = await deathPromise;
      if (!closed) {
        // Escalate: non-Windows SIGKILL; Windows fallback if taskkill failed.
        try {
          if (process.platform === "win32") proc.kill();
          else proc.kill("SIGKILL");
        } catch (e) {
          console.error("[beru] kill escalate error:", e.message);
        }
        await waitForProcessClose(proc, 3000);
      }
    }
    // When a child was alive, onClose owns the single cancelled finished emit
    // (if this run is still cancelling). Do not emit a second finished here.
  }

  // Always attempt incomplete-output cleanup after cancel settles (grace exit
  // or force-kill). Keep completed outputs; never touch inputs.
  cleanupIncompleteOutputsAfterCancel();

  // Probe-only cancel (no child) or onClose did not settle this runId:
  // clear the lock and emit exactly one cancelled finished.
  if (runId && getProcessingRunId() === runId) {
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
    sendToRenderer("process:finished", { code: null, cancelled: true });
  } else if (!runId && getPythonProcess() === proc) {
    setPythonProcess(null);
  }

  if (runId) clearCancellingRunId(runId);
  else clearCancellingRunId();

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

    const processorCheck = validateProcessorAvailable();
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

    // Path security first — never open/stat arbitrary renderer paths before
    // validateReadableFile has constrained them to trusted roots / allow-list.
    let safeJobs;
    try {
      safeJobs = prepareJobsForProcessor(jobs, outputDirectory, pathSecurity);
    } catch (securityError) {
      return { success: false, error: securityError.message };
    }

    const unreadable = findUnreadableInputs(safeJobs);
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

    const runId = `${Date.now()}-${randomBytes(4).toString("hex")}`;
    if (!beginProcessingRun(runId)) {
      return { success: false, error: "Ya hay un proceso en ejecución" };
    }
    // Mark the probe phase active so the processing-lock watchdog rearms while
    // ffprobe is enriching the batch (no processor child exists yet, so
    // isPythonChildAlive() alone would let it fire mid-probe on large batches).
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

      // Capture tmpFile in closure so this run always cleans up its own file,
      // even if a new run overwrites the shared _currentTmpFile.
      const runTmpFile = tmpFile;
      const runCancelFile = cancelFile;
      const isCurrentRun = () => getProcessingRunId() === runId;

      const cleanupRunArtifacts = () => {
        try {
          if (runTmpFile) fs.unlinkSync(runTmpFile);
        } catch {}
        try {
          if (runCancelFile) fs.unlinkSync(runCancelFile);
        } catch {}
      };

      const probeLimit = Math.max(1, Math.min(8, safeJobs.length, (os.cpus()?.length || 4) * 2));
      // Stop spawning ffprobe probes once this run is cancelled, so a cancel
      // during the probe phase doesn't keep probing the rest of the batch.
      const enrichedJobs = await runWithConcurrency(
        safeJobs,
        probeLimit,
        enrichJobVideoInfo,
        undefined,
        () => !isCurrentRun(),
      );

      // The probe above can take seconds. If the user cancelled during the
      // probe, cancelActiveProcessing() already cleared our runId and tmpFile.
      // Bail before spawning so we don't start a Python process that nobody
      // owns — it would run to completion (or until the watchdog fires) with
      // no way for the renderer to cancel it. Also bail if the app is quitting
      // (probe-phase quit race before cancel clears the runId).
      if (!isCurrentRun() || getAppIsQuitting()) {
        cleanupRunArtifacts();
        return { success: false, error: "Procesamiento cancelado", cancelled: true };
      }
      // Probe phase is over — the processor child is about to spawn, so the
      // watchdog can now rely on isPythonChildAlive() to rearm.
      setProbePhaseActive(false);

      await fs.promises.writeFile(
        tmpFile,
        JSON.stringify(createProcessorManifest(manifest, enrichedJobs)),
      );

      // Cancel / quit can land during writeFile (async). Re-check before spawn
      // so we never install an unowned processor child after cancel cleared the run.
      if (!isCurrentRun() || getAppIsQuitting()) {
        cleanupRunArtifacts();
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

      const spawnSpec = resolveProcessorSpawn([tmpFile]);
      if (!spawnSpec) {
        throw new Error("No se pudo iniciar el procesador de video");
      }

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
      // Snapshot outputs at spawn so cancel cleanup works if tmp JSON is gone.
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
          // Drop orphaned ref if this child is still installed as the live proc.
          if (getPythonProcess() === proc) setPythonProcess(null);
          cleanupRunArtifacts();
          // Keep snapshot for cancel cleanup; cancel owns incomplete unlinks.
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
        // If onError already settled this run (spawn failure), don't emit a
        // second terminal signal — the renderer would otherwise receive both
        // `process:error` and `process:finished`, leaving the execution
        // history in an ambiguous state.
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

        // Cancel owns terminal signalling: emit cancelled once here so
        // cancelActiveProcessing does not also emit after kill waits.
        if (cancellingThisRun) {
          sendToRenderer("process:finished", { code: null, cancelled: true });
          clearCancellingRunId(runId);
          return settleRun({ success: false, code: null, cancelled: true });
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
        // Include error on finished so the renderer can toast when no prior
        // process:error was emitted (crash / OOM / unexpected exit).
        sendToRenderer("process:finished", failed ? { code, error: errMsg } : { code });
        return settleRun({
          success: !failed,
          code,
          error: failed ? errMsg : undefined,
        });
      };

      const onError = (err) => {
        if (isCurrentRun()) {
          const translated = translateProcessorErrorMessage(err.message);
          setLastProcessingError(translated);
          sendToRenderer("process:error", translated);
          return settleRun({ success: false, code: 1, error: translated });
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
