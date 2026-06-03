import { ipcMain } from "electron";
import { spawn, exec } from "child_process";
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
  setIsProcessing,
  getLastProcessingError,
  setLastProcessingError,
} from "../shared-state.js";
import { getPythonPath, getFfmpegPath, getFfprobePath } from "../utils/paths.js";
import { probeVideo } from "../utils/video-cache.js";
import { readSettings } from "../utils/settings.js";
import { sendToRenderer } from "../utils/renderer.js";
import { runWithConcurrency } from "../utils/concurrency.js";

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

export function registerProcessHandlers(pathSecurity) {
  ipcMain.handle("process:start", async (_event, jobs) => {
    if (getIsProcessing()) {
      return { success: false, error: "Ya hay un proceso en ejecución" };
    }

    if (!Array.isArray(jobs) || jobs.length === 0) {
      return { success: false, error: "No hay videos para procesar" };
    }

    try {
      const scriptPath = getPythonPath();
      if (!fs.existsSync(scriptPath)) {
        return { success: false, error: "processor.py not found" };
      }

      for (const job of jobs) {
        if (job?.input_path) pathSecurity.registerAllowedPath(job.input_path);
      }

      setIsProcessing(true);
      setLastProcessingError(null);

      const uid = `${Date.now()}-${randomBytes(4).toString("hex")}`;
      const tmpFile = path.join(app.getPath("temp"), `beru-jobs-${uid}.json`);
      setCurrentTmpFile(tmpFile);
      const cancelFile = tmpFile.replace(".json", ".cancel");
      try {
        fs.unlinkSync(cancelFile);
      } catch {}
      const enrichedJobs = await Promise.all(
        jobs.map(async (job) => {
          const sw = Number(job.source_width || job.width || 0);
          const sh = Number(job.source_height || job.height || 0);
          if (sw > 0 && sh > 0) {
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
              return {
                ...job,
                width: info.width,
                height: info.height,
                source_width: info.width,
                source_height: info.height,
                video_duration: info.duration || job.video_duration || 0,
                video_codec: info.videoCodec || job.video_codec || "",
                pix_fmt: info.pixFmt || job.pix_fmt || "yuv420p",
                frame_rate: info.frameRate || job.frame_rate || 0,
                audio_codec: info.audioCodec || job.audio_codec || "",
                audio_channels: info.audioChannels || job.audio_channels || 0,
              };
            }
          } catch (e) {
            console.error("[beru] Job probe failed:", job.input_path, e.message);
          }
          return job;
        }),
      );

      await fs.promises.writeFile(tmpFile, JSON.stringify(enrichedJobs));

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

      const finishProcessing = (result) => {
        setPythonProcess(null);
        setIsProcessing(false);
        try {
          const currentTmp = getCurrentTmpFile();
          currentTmp && fs.unlinkSync(currentTmp);
        } catch {}
        setCurrentTmpFile(null);
        return result;
      };

      proc.stdout.on("data", (data) => {
        stdoutBuf += data.toString();
        const lines = stdoutBuf.split("\n");
        stdoutBuf = lines.pop() || "";
        for (const line of lines) dispatchProcessorLine(line);
      });

      proc.stderr.on("data", (data) => {
        const text = data.toString().trim();
        if (text) console.error("[beru][processor]", text);
      });

      return new Promise((resolve) => {
        proc.on("close", (code) => {
          if (stdoutBuf.trim()) dispatchProcessorLine(stdoutBuf);
          sendToRenderer("process:finished", { code });
          const failed = code !== 0;
          resolve(
            finishProcessing({
              success: !failed,
              code,
              error: failed
                ? getLastProcessingError() || `Process exited with code ${code}`
                : undefined,
            }),
          );
        });

        proc.on("error", (err) => {
          setLastProcessingError(err.message);
          sendToRenderer("process:error", err.message);
          resolve(finishProcessing({ success: false, code: 1, error: err.message }));
        });
      });
    } catch (err) {
      setIsProcessing(false);
      setPythonProcess(null);
      console.error("[beru] process:start failed:", err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle("process:cancel", async () => {
    const currentTmp = getCurrentTmpFile();
    if (currentTmp) {
      const cancelFile = currentTmp.replace(".json", ".cancel");
      try {
        fs.writeFileSync(cancelFile, "1");
      } catch {}
    }

    const proc = getPythonProcess();
    if (proc && proc.pid) {
      if (process.platform === "win32") {
        exec(`taskkill /F /T /PID ${proc.pid}`, (err) => {
          if (err) console.error("[beru] taskkill error:", err.message);
        });
      } else {
        proc.kill("SIGTERM");
      }
      setPythonProcess(null);
    }
    return { success: true };
  });
}
