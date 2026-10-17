import { app } from "electron";
import { randomBytes } from "crypto";
import fs from "fs";
import os from "os";
import { getAppIsQuitting } from "./shared-state.js";
import { createCancelArtifacts } from "./utils/cancel-artifacts.js";
import { createRunOutputFiles } from "./utils/process-output.js";
import { sendToRenderer } from "./utils/renderer.js";
import { setMediaProcessingActive, waitForMediaTasksToDrain } from "./utils/media-task-pool.js";
import { killProcessTree } from "./utils/kill-process-tree.js";
import { startJobRun } from "./utils/job-worker.js";
import { probeVideo } from "./utils/video-cache.js";
import { readSettings } from "./utils/settings.js";
import { runWithConcurrency } from "./utils/concurrency.js";
import { buildJobManifest } from "../shared/build-job-manifest.js";
import { translateProcessorErrorMessage } from "./utils/process-input-validation.js";
import { IPC_EVENTS, emitRunEvent } from "../shared/ipc-channels.js";
import { RUN_EVENTS, RUN_LIFECYCLE, isRunEvent } from "../shared/run-events.js";

const PROCESSING_LOCK_MAX_MS = 5 * 60 * 1000;
const CANCEL_KILL_GRACE_MS = 1500;

let activeRun = null;

export const hasActiveProcessing = () => activeRun !== null;
export const getPythonProcess = () => activeRun?.proc || null;

const isCurrent = (run) => activeRun === run && !run.result;
const isInterrupted = (run) => !isCurrent(run) || run.cancellation || getAppIsQuitting();
const isChildAlive = (proc) => Boolean(proc && proc.exitCode == null && proc.signalCode == null);

function eventChannel(run, channel) {
  if (
    channel === IPC_EVENTS[RUN_LIFECYCLE.started] ||
    channel === IPC_EVENTS[RUN_LIFECYCLE.finished]
  )
    return channel;
  return run.events ? run.events[channel] : channel;
}

function emit(run, channel, payload) {
  const target = eventChannel(run, channel);
  if (target && isCurrent(run)) emitRunEvent(sendToRenderer, target, run.runId, payload);
}

function emitError(run, error) {
  if (run.errorEmitted) return;
  run.errorEmitted = true;
  emit(run, IPC_EVENTS.onError, { error });
}

function settlePendingJobs(
  run,
  cancelled = false,
  error = "El procesador finalizó sin confirmar el resultado de este video",
) {
  for (const [index, result] of run.jobs || []) {
    if (result) continue;
    run.jobs.set(index, { status: cancelled ? "cancelled" : "failed", error });
    emit(run, cancelled ? IPC_EVENTS.onJobCancelled : IPC_EVENTS.onJobError, {
      type: cancelled ? RUN_EVENTS.cancelled.type : RUN_EVENTS.error.type,
      index,
      ...(!cancelled ? { error } : {}),
    });
  }
}

function finish(run, result, channel, payload) {
  if (run.result) return;
  settlePendingJobs(run, result.cancelled, result.error);
  if (run.jobs) {
    const outcomes = [...run.jobs.values()];
    emit(run, IPC_EVENTS.onSummary, {
      ...run.summary,
      type: RUN_EVENTS.summary.type,
      total: outcomes.length,
      succeeded: outcomes.filter((job) => job.status === "succeeded").length,
      failed: outcomes.filter((job) => job.status === "failed").length,
      cancelled: outcomes.filter((job) => job.status === "cancelled").length,
    });
  }
  const outputs = [...(run.jobs ?? [])]
    .filter(([, job]) => job.status === "succeeded")
    .map(([index, { output, outputStat }]) => ({ index, output, outputStat }));
  run.result = { ...result, runId: run.runId, outputs };
  clearTimeout(run.watchdog);
  run.detachChild?.();
  run.abortController.abort();
  run.artifacts?.dispose();
  run.outputFiles?.dispose();
  run.proc = null;
  if (activeRun === run) {
    activeRun = null;
    setMediaProcessingActive(false);
    const target = eventChannel(run, channel);
    if (target) emitRunEvent(sendToRenderer, target, run.runId, payload);
  }
  run.resolve(run.result);
}

function finishCancelled(run) {
  finish(
    run,
    { success: false, code: null, error: "Procesamiento cancelado", cancelled: true },
    IPC_EVENTS.onFinished,
    { code: null, cancelled: true },
  );
}

function stopIfInterrupted(run) {
  if (!isInterrupted(run)) return false;
  if (!run.cancellation) finishCancelled(run);
  return true;
}

function armWatchdog(run) {
  run.watchdog = setTimeout(async () => {
    if (!isCurrent(run)) return;
    if (
      run.phase === "preparing" ||
      run.cancellation ||
      run.termination ||
      isChildAlive(run.proc)
    ) {
      armWatchdog(run);
      return;
    }
    const error =
      "El procesamiento se interrumpió de forma inesperada. Puedes volver a intentarlo.";
    await Promise.all(run.promotions.values());
    if (!isCurrent(run) || run.cancellation) return;
    console.error("[beru] Processing lock watchdog fired for run " + run.runId);
    emitError(run, error);
    finish(run, { success: false, code: 1, error });
  }, PROCESSING_LOCK_MAX_MS);
  run.watchdog?.unref?.();
}

async function completeOutput(run, msg) {
  try {
    const output = await run.outputFiles.complete(msg.index);
    const { size, mtimeMs, ctimeMs } = fs.statSync(output);
    const outputStat = { size, mtimeMs, ctimeMs };
    run.jobs.set(msg.index, { status: "succeeded", output, outputStat });
    emit(run, IPC_EVENTS.onComplete, { ...msg, output, outputStat });
  } catch (err) {
    run.outputError = true;
    run.lastError = "No se pudo guardar la exportación: " + err.message;
    run.jobs.set(msg.index, { status: "failed", error: run.lastError });
    emit(run, IPC_EVENTS.onJobError, {
      type: RUN_EVENTS.error.type,
      index: msg.index,
      error: run.lastError,
    });
  }
}

function dispatchProcessorLine(run, line) {
  if (!isCurrent(run) || !line.trim()) return;
  try {
    const msg = JSON.parse(line);
    if (!isRunEvent(msg)) throw new Error("Respuesta inválida del procesador");
    const event = Object.values(RUN_EVENTS).find((event) => event.type === msg.type);
    if (!event) return;
    const channel = IPC_EVENTS[event.subscription];
    if (
      [RUN_EVENTS.complete, RUN_EVENTS.cancelled, RUN_EVENTS.jobProgress].includes(event) ||
      (event === RUN_EVENTS.error && msg.index != null)
    ) {
      if (!run.jobs.has(msg.index))
        throw new Error("El procesador devolvió un trabajo desconocido");
      if (run.jobs.get(msg.index)?.status === "succeeded") return;
    }
    if (event === RUN_EVENTS.progress || event === RUN_EVENTS.jobProgress) emit(run, channel, msg);
    else if (event === RUN_EVENTS.complete) {
      if (!run.promotions.has(msg.index)) run.promotions.set(msg.index, completeOutput(run, msg));
    } else if (event === RUN_EVENTS.cancelled) {
      run.jobs.set(msg.index, { status: "cancelled" });
      emit(run, channel, msg);
    } else if (event === RUN_EVENTS.error) {
      const error = msg.error || "Unknown error";
      if (Number.isInteger(msg.index)) {
        run.jobs.set(msg.index, { status: error === "Cancelled" ? "cancelled" : "failed", error });
        if (error === "Cancelled")
          emit(run, IPC_EVENTS[RUN_EVENTS.cancelled.subscription], {
            type: RUN_EVENTS.cancelled.type,
            index: msg.index,
          });
        else emit(run, IPC_EVENTS[event.jobSubscription], msg);
      } else {
        run.lastError = translateProcessorErrorMessage(error);
        run.protocolError = true;
        emitError(run, run.lastError);
      }
    } else if (event === RUN_EVENTS.summary) {
      run.summary = msg;
    } else if (event === RUN_EVENTS.warning) {
      emit(run, channel, {
        index: msg.index,
        code: msg.code || "unknown",
        message: msg.message || "",
      });
    }
  } catch (err) {
    run.protocolError = true;
    run.lastError = "Respuesta inválida del procesador: " + err.message;
    console.error("[beru]", run.lastError);
  }
}

async function enrichJobVideoInfo(job) {
  if (job.video_info_probed || !job.input_path) return job;
  try {
    const info = await probeVideo(job.input_path);
    if (info.width > 0 && info.height > 0) {
      const width = job.source_width || Number(info.width);
      const height = job.source_height || Number(info.height);
      return {
        ...job,
        width,
        height,
        source_width: width,
        source_height: height,
        video_duration: info.duration || job.video_duration,
        video_codec: info.videoCodec || job.video_codec,
        pix_fmt: info.pixFmt || job.pix_fmt,
        frame_rate: info.frameRate || job.frame_rate,
        audio_codec: info.audioCodec || job.audio_codec,
        audio_channels: info.audioChannels || job.audio_channels,
        video_info_probed: true,
      };
    }
  } catch (err) {
    console.error("[beru] Job probe failed:", job.input_path, err.message);
  }
  return job;
}

function watchWorker(run, worker) {
  const proc = worker.proc;
  const end = async (code) => {
    await Promise.all(run.promotions.values());
    if (!isCurrent(run) || run.cancellation) return;
    settlePendingJobs(run);
    const jobFailure = [...run.jobs.values()].find((result) => result.status !== "succeeded");
    if ((run.protocolError || run.outputError || jobFailure) && code === 0) code = 1;
    const failed = code !== 0;
    const tail = worker.stderrTail().trim();
    const error = failed
      ? translateProcessorErrorMessage(
          run.lastError ||
            jobFailure?.error ||
            "Process exited with code " + code + (tail ? ": " + tail.slice(-300) : ""),
        )
      : undefined;
    finish(run, { success: !failed, code, error }, IPC_EVENTS.onFinished, {
      code,
      ...(failed ? { error } : {}),
    });
  };
  const onClose = (code) => {
    if (!run.termination) void end(code || 1).catch(onError);
  };
  const onError = (err) => {
    if (!isCurrent(run) || run.cancellation || run.termination) return;
    const error = translateProcessorErrorMessage(err.message);
    run.lastError = error;
    const termination = proc.pid && isChildAlive(proc) ? stopWorker(run) : Promise.resolve();
    termination
      .then(async () => {
        await Promise.all(run.promotions.values());
        if (!isCurrent(run) || run.cancellation) return;
        emitError(run, error);
        finish(run, { success: false, code: 1, error });
      })
      .catch((killError) => {
        console.error("[beru] failed worker is still active:", killError.message);
        for (const [index, result] of run.jobs) {
          if (!result)
            emit(run, IPC_EVENTS.onJobError, {
              type: RUN_EVENTS.error.type,
              index,
              error: error + ": " + killError.message,
            });
        }
      });
  };
  proc.once("close", onClose);
  proc.once("error", onError);
  run.detachChild = () => {
    proc.removeListener("close", onClose);
    proc.removeListener("error", onError);
  };
  worker.done
    .then(async (outcome) => {
      if (!isCurrent(run) || run.cancellation || !outcome) return;
      if (outcome.error) run.lastError = outcome.error;
      if (outcome.died && isChildAlive(proc)) {
        run.phase = "stopping";
        await stopWorker(run);
      }
      await end(outcome.died ? outcome.code || 1 : outcome.ok ? 0 : 1);
    })
    .catch(onError);
}

async function prepareAndStart(run, { manifest, jobs, outputDirectory, spawnSpec, overwrite }) {
  run.outputFiles = createRunOutputFiles(jobs, outputDirectory, { overwrite });
  run.jobs = new Map(jobs.map((job, index) => [Number.isInteger(job.id) ? job.id : index, null]));
  const artifacts = await createCancelArtifacts(app.getPath("temp"));
  if (stopIfInterrupted(run)) {
    artifacts.dispose();
    return;
  }
  run.artifacts = artifacts;
  await waitForMediaTasksToDrain();
  if (stopIfInterrupted(run)) return;
  const stagedJobs = run.outputFiles.jobs;
  const probeLimit = Math.max(2, Math.min(8, stagedJobs.length, (os.cpus()?.length || 4) * 2));
  const enrichedJobs = await runWithConcurrency(
    stagedJobs,
    probeLimit,
    enrichJobVideoInfo,
    undefined,
    () => Boolean(isInterrupted(run)),
  );
  if (stopIfInterrupted(run)) return;
  await fs.promises.writeFile(
    artifacts.manifestPath,
    JSON.stringify(buildJobManifest(enrichedJobs, manifest?.createdAt)),
  );
  if (stopIfInterrupted(run)) return;
  run.phase = "starting";
  const settings = readSettings();
  const workers = Number(settings.batchWorkers);
  const worker = await startJobRun({
    spawnSpec,
    jobsFile: artifacts.manifestPath,
    signal: run.abortController.signal,
    onReady: (proc) => {
      if (!isInterrupted(run)) run.proc = proc;
    },
    env: {
      BERU_WORKERS: workers > 0 ? String(Math.min(16, Math.floor(workers))) : "0",
      BERU_WORKERS_MODE: settings.batchWorkersMode === "conservative" ? "conservative" : "balanced",
      BERU_RETRY_FAILED: settings.batchRetryFailed === false ? "0" : "1",
    },
    onLine: (line) => dispatchProcessorLine(run, line),
  });
  run.workerDone = worker?.done;
  if (stopIfInterrupted(run)) return;
  if (!worker) return finishCancelled(run);
  run.proc = worker.proc;
  run.phase = "running";
  watchWorker(run, worker);
}

export function executeProcessingRun(options) {
  if (getAppIsQuitting())
    return Promise.resolve({ success: false, error: "Procesamiento cancelado", cancelled: true });
  if (hasActiveProcessing())
    return Promise.resolve({
      success: false,
      error: "Ya hay un proceso en ejecución",
      code: "already_processing",
      runId: activeRun.runId,
      owner: activeRun.owner,
    });
  const run = {
    runId: Date.now() + "-" + randomBytes(16).toString("hex"),
    phase: "preparing",
    owner: options.owner,
    events: options.events,
    proc: null,
    artifacts: null,
    outputFiles: null,
    promotions: new Map(),
    abortController: new AbortController(),
    result: null,
    cancellation: null,
  };
  const done = new Promise((resolve) => {
    run.resolve = resolve;
  });
  activeRun = run;
  setMediaProcessingActive(true);
  armWatchdog(run);
  emit(run, IPC_EVENTS.onRunStarted, run.owner ? { owner: run.owner } : undefined);
  prepareAndStart(run, options).catch((err) => {
    if (stopIfInterrupted(run)) return;
    const error = translateProcessorErrorMessage(err.message);
    emitError(run, error);
    finish(run, { success: false, code: 1, error });
  });
  return done;
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
    if (proc.exitCode != null || proc.signalCode != null) {
      clearTimeout(timeout);
      proc.removeListener("close", onClose);
      resolve(true);
    }
  });
}

async function killTreeOrChild(proc) {
  try {
    await killProcessTree(proc);
  } catch (err) {
    console.error("[beru] tree termination failed:", err.message);
    try {
      proc.kill();
    } catch (killError) {
      console.error("[beru] kill fallback failed:", killError.message);
    }
  }
}

async function terminateRunProcess(proc) {
  if (!isChildAlive(proc)) {
    await killTreeOrChild(proc);
    return;
  }
  const death = waitForProcessClose(proc);
  await killTreeOrChild(proc);
  if (!(await death)) {
    try {
      proc.kill();
    } catch (err) {
      console.error("[beru] kill escalate error:", err.message);
    }
    if (!(await waitForProcessClose(proc, 3000))) {
      throw new Error("No se pudo confirmar el cierre del motor de procesamiento");
    }
  }
}

function stopWorker(run) {
  if (!run.termination)
    run.termination = Promise.resolve()
      .then(() => terminateRunProcess(run.proc))
      .catch((err) => {
        run.termination = null;
        throw err;
      });
  return run.termination;
}

async function cancelWorker(run) {
  if (run.termination) return run.termination;
  const outcome = await new Promise((resolve) => {
    const proc = run.proc;
    const settle = (value) => {
      clearTimeout(timer);
      proc.removeListener("close", onClose);
      resolve(value);
    };
    const onClose = () => settle("closed");
    const timer = setTimeout(() => settle("timeout"), CANCEL_KILL_GRACE_MS);
    proc.once("close", onClose);
    run.workerDone?.then(
      (result) =>
        settle(
          typeof result?.ok === "boolean" && !result.died && !result.error
            ? "acknowledged"
            : "timeout",
        ),
      () => settle("timeout"),
    );
    if (!isChildAlive(proc)) settle("closed");
  });
  if (outcome === "closed") await killTreeOrChild(run.proc);
  else if (outcome !== "acknowledged") await stopWorker(run);
}

export async function cancelRun({ owner } = {}) {
  const run = activeRun;
  if (!run || (owner && run.owner !== owner)) return { success: true, idle: true };
  if (!run.cancellation) {
    let resolveCancellation;
    run.cancellation = new Promise((resolve) => {
      resolveCancellation = resolve;
    });
    run.abortController.abort();
    run.artifacts?.markCancelled();
    const termination = run.proc?.pid ? cancelWorker(run) : Promise.resolve();
    termination
      .then(async () => {
        await Promise.all(run.promotions.values());
        finishCancelled(run);
        resolveCancellation({ success: true, idle: false });
      })
      .catch((err) => {
        console.error("[beru] cancel termination failed:", err.message);
        run.cancellation = null;
        resolveCancellation({ success: false, error: err.message });
      });
  }
  return run.cancellation;
}
