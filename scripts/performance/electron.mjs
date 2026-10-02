import { app } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { checkStartupPanels } from "./report.mjs";
import { observeRenderer, importVideos, previewFrames, exportWithPreview } from "./renderer.js";

const config = JSON.parse(fs.readFileSync(process.env.BERU_PERF_CONFIG, "utf8"));
app.setPath("userData", config.profile);
app.setPath("sessionData", config.profile);
process.env.BERU_DEV_URL = pathToFileURL(path.join(config.build, "index.html")).href;
const result = {
  label: config.label,
  phases: [],
  errors: [],
  requests: [],
  versions: process.versions,
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let phase;
let timer;
let window;
let finishing = false;

async function finish(error) {
  if (finishing) return;
  finishing = true;
  clearInterval(timer);
  if (error) result.failure = error.stack || String(error);
  try {
    const { cancelRun } = await import("../../main/processing-run.js");
    await cancelRun();
    const { disposePreviewFrameWorker } = await import("../../main/utils/preview-frame-cache.js");
    disposePreviewFrameWorker();
  } catch (cleanupError) {
    result.cleanupError = String(cleanupError);
    result.failure ||= `Cleanup failed: ${cleanupError}`;
  }
  fs.writeFileSync(config.result, JSON.stringify(result, null, 2));
  if (window && !window.isDestroyed()) window.setAlwaysOnTop(false);
  app.quit();
  setTimeout(() => app.exit(error ? 1 : 0), 3000).unref();
}

function sample() {
  return {
    atMs: Date.now() - config.started,
    availableBytes: os.freemem(),
    workingSetBytes: app
      .getAppMetrics()
      .reduce((sum, proc) => sum + proc.memory.workingSetSize * 1024, 0),
  };
}

app.on("browser-window-created", async (_event, win) => {
  if (window) return;
  window = win;
  const wc = win.webContents;
  const loaded = new Promise((resolve, reject) => {
    wc.once("did-finish-load", resolve);
    wc.once("did-fail-load", (_event, code, description) =>
      reject(new Error(`${code}: ${description}`)),
    );
  });
  const debuggerClient = wc.debugger;
  const send = (method, params = {}) => debuggerClient.sendCommand(method, params);
  const evaluate = async (expression) => {
    const response = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (response.exceptionDetails) {
      throw new Error(
        response.exceptionDetails.exception?.description || response.exceptionDetails.text,
      );
    }
    return response.result.value;
  };
  const call = (fn, args) => evaluate(`(${fn.toString()})(${JSON.stringify(args)})`);
  const resetFrames = () =>
    evaluate(
      "__beruPerf.frames = []; __beruPerf.last = 0; __beruPerf.hidden = document.visibilityState !== 'visible'; undefined",
    );
  const endPhase = async () => {
    phase.samples.push(sample());
    const data = await evaluate(
      "({frames: __beruPerf.frames, hidden: __beruPerf.hidden, heapBytes: performance.memory.usedJSHeapSize})",
    );
    Object.assign(phase, data);
    if (data.hidden) throw new Error(`Window hidden during ${phase.name}; measurement invalid`);
    result.phases.push(phase);
    phase = null;
  };
  const measure = async (name, action) => {
    await resetFrames();
    phase = { name, samples: [sample()] };
    const started = performance.now();
    phase.action = await action();
    phase.elapsedMs = performance.now() - started;
    await endPhase();
  };
  try {
    debuggerClient.attach("1.3");
    const scriptRequests = new Set();
    debuggerClient.on("message", (_event, method, payload) => {
      if (method === "Network.requestWillBeSent" && payload.type === "Script") {
        result.requests.push(payload.request.url);
        scriptRequests.add(payload.requestId);
      }
      if (method === "Runtime.exceptionThrown") result.errors.push(payload.exceptionDetails.text);
      if (method === "Network.loadingFailed" && scriptRequests.has(payload.requestId))
        result.errors.push(payload.errorText);
    });
    await send("Network.enable");
    await send("Runtime.enable");
    await send("Page.enable");
    await send("Page.addScriptToEvaluateOnNewDocument", {
      source: `(${observeRenderer.toString()})()`,
    });
    phase = {
      name:
        config.kind === "warm"
          ? "startup-reused-profile"
          : config.kind === "scenarios"
            ? "startup-scenarios-profile"
            : "startup-new-profile",
      samples: [sample()],
    };
    timer = setInterval(() => {
      if (phase) phase.samples.push(sample());
    }, 250);
    await loaded;
    win.show();
    win.restore();
    win.focus();
    win.setAlwaysOnTop(true);
    await evaluate(`(async () => {
      if (!window.__beruPerf) (${observeRenderer.toString()})();
      await __beruPerf.wait(() => document.querySelector('.app-shell') && window.__beruPerfStore, 'app shell');
      await __beruPerf.paint();
    })()`);
    phase.elapsedMs = Date.now() - config.started;
    await sleep(2000);
    const resources = await evaluate(
      "performance.getEntriesByType('resource').map(entry => entry.name).filter(name => new URL(name).pathname.endsWith('.js'))",
    );
    result.startupRequests = [...new Set([...result.requests, ...resources])];
    if (!result.startupRequests.length) throw new Error("No startup scripts observed");
    result.startupState = await evaluate(`(() => {
      const s = __beruPerfStore.getState();
      return {queueLength: s.queue.length, showShortcuts: s.showShortcuts, showSettings: s.showSettings, showTableEditor: s.showTableEditor, showMappingModal: s.showMappingModal, showWatermarkModal: s.showWatermarkModal, showPetPalette: s.showPetPalette, petEnabled: s.petEnabled, petPoppedOut: s.petPoppedOut};
    })()`);
    if (Object.values(result.startupState).some(Boolean))
      throw new Error("Startup profile is not empty with closed panels");
    result.startupJavascriptBytes = config.chunks
      .filter((chunk) =>
        result.startupRequests.some((url) => new URL(url).pathname.endsWith(`/${chunk.file}`)),
      )
      .reduce((sum, chunk) => sum + chunk.bytes, 0);
    result.panelViolations = checkStartupPanels(result.startupRequests, config.chunks);
    await endPhase();
    if (result.panelViolations.length)
      throw new Error(`Closed panels loaded: ${JSON.stringify(result.panelViolations)}`);
    const { getFfmpegPath, getFfprobePath } = await import("../../main/utils/paths.js");
    const { resolveProcessorSpawnAsync } = await import("../../main/utils/processor-spawn.js");
    const version = (command, args) =>
      execFileSync(command, args, { encoding: "utf8", windowsHide: true, timeout: 10000 })
        .trim()
        .split(/\r?\n/)[0];
    const processor = await resolveProcessorSpawnAsync();
    if (!processor) throw new Error("Processor unavailable");
    result.binaries = {
      ffmpeg: { path: getFfmpegPath(), version: version(getFfmpegPath(), ["-version"]) },
      ffprobe: { path: getFfprobePath(), version: version(getFfprobePath(), ["-version"]) },
      processor: {
        ...processor,
        path:
          processor.mode === "script"
            ? version(processor.command, [
                ...processor.args.slice(0, -1),
                "-c",
                "import sys; print(sys.executable)",
              ])
            : processor.command,
        version:
          processor.mode === "script"
            ? version(processor.command, [...processor.args.slice(0, -1), "--version"])
            : "bundled; see binary hash",
      },
    };
    if (config.kind === "scenarios") {
      await measure("import-cold", () => call(importVideos, config.paths));
      await measure("import-cached", () => call(importVideos, config.paths));
      await measure("preview-first-request", () =>
        call(previewFrames, { path: config.paths[0], timestamps: [0.75] }),
      );
      await measure("preview-warm-worker", () =>
        call(previewFrames, { path: config.paths[0], timestamps: [1.25, 1.75, 2.25] }),
      );
      await measure("preview-cached", () =>
        call(previewFrames, { path: config.paths[0], timestamps: [0.75] }),
      );
      await call(importVideos, config.paths.slice(0, 2));
      await evaluate(`{
        const state = __beruPerfStore.getState();
        state.selectVideo(0);
        state.setCurrentRegion({x: 0.1, y: 0.1, w: 0.4, h: 0.4});
        state.addOperation('blur');
      } undefined`);
      await measure("preview-processed-blur", () =>
        call(previewFrames, {
          path: config.paths[0],
          timestamps: [0.75, 1.25, 1.75],
          processed: true,
        }),
      );
      await call(importVideos, config.paths.slice(0, 2));
      fs.mkdirSync(config.output, { recursive: true });
      await measure("export-with-preview", () =>
        call(exportWithPreview, { paths: config.paths.slice(0, 2), outputDir: config.output }),
      );
      result.outputs = fs
        .readdirSync(config.output)
        .filter((name) => name.endsWith(".mp4"))
        .map((name) => {
          const file = path.join(config.output, name);
          const probe = JSON.parse(
            execFileSync(
              getFfprobePath(),
              ["-v", "error", "-show_streams", "-show_format", "-of", "json", file],
              { encoding: "utf8", windowsHide: true, timeout: 10000 },
            ),
          );
          const video = probe.streams.find((stream) => stream.codec_type === "video");
          const duration = Number(probe.format.duration);
          const [numerator, denominator] = String(video?.avg_frame_rate).split("/").map(Number);
          const fps = numerator / denominator;
          if (
            !video ||
            video.codec_name !== "h264" ||
            video.width !== 1920 ||
            video.height !== 1080 ||
            !Number.isFinite(duration) ||
            Math.abs(duration - 4) > 0.2 ||
            !Number.isFinite(fps) ||
            Math.abs(fps - 30) > 0.01
          )
            throw new Error(`Invalid export: ${name}`);
          return {
            name,
            bytes: fs.statSync(file).size,
            codec: video.codec_name,
            width: video.width,
            height: video.height,
            duration,
            fps,
          };
        });
      if (result.outputs.length !== 2) throw new Error("Expected exactly two exports");
    }
    if (result.errors.length) throw new Error(`Runtime errors: ${JSON.stringify(result.errors)}`);
    await finish();
  } catch (error) {
    await finish(error);
  }
});

setTimeout(() => finish(new Error("Scenario deadline exceeded")), config.timeoutMs - 5000).unref();
await import("../../main/main.js");
