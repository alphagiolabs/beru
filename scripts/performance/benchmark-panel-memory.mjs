import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

if (!process.versions.electron) {
  const [sourceArg, minutesArg = "15", countArg = "500", option] = process.argv.slice(2);
  const minutes = Number(minutesArg);
  const count = Number(countArg);
  if (
    !sourceArg ||
    !Number.isFinite(minutes) ||
    minutes <= 0 ||
    !Number.isInteger(count) ||
    count < 1 ||
    (option && option !== "--without-palette")
  ) {
    throw new Error(
      "Usage: node scripts/performance/benchmark-panel-memory.mjs video.mp4 [minutes=15] [queueItems=500] [--without-palette]",
    );
  }
  const source = path.resolve(sourceArg);
  const probe = JSON.parse(
    execFileSync(
      path.join(root, "bin", "ffprobe.exe"),
      ["-v", "error", "-show_streams", "-show_format", "-of", "json", source],
      { encoding: "utf8" },
    ),
  );
  const video = probe.streams.find((s) => s.codec_type === "video");
  if (!video) throw new Error("Input must contain video");
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "beru-panel-memory-"));
  const config = {
    source,
    minutes,
    count,
    video,
    duration: Number(video.duration || probe.format.duration),
    output,
    includePalette: option !== "--without-palette",
  };
  fs.writeFileSync(path.join(output, "config.json"), JSON.stringify(config));
  process.chdir(root);
  process.env.VITE_SUPABASE_URL = "";
  process.env.VITE_SUPABASE_ANON_KEY = "";
  const { build } = await import("vite");
  await build({
    build: { outDir: path.join(output, "build") },
    plugins: [
      {
        name: "isolated-memory-audit",
        transform(code, id) {
          if (id.replaceAll("\\", "/").endsWith("/src/stores/useEditorStore.js")) {
            return code + "\nwindow.__memoryAuditStore = useEditorStore;\n";
          }
        },
      },
    ],
  });
  const env = { ...process.env, BERU_PANEL_MEMORY_CONFIG: path.join(output, "config.json") };
  delete env.ELECTRON_RUN_AS_NODE;
  const log = fs.openSync(path.join(output, "electron.log"), "wx");
  const electron = spawn(
    path.join(root, "node_modules", "electron", "dist", "electron.exe"),
    [fileURLToPath(import.meta.url)],
    { cwd: root, env, stdio: ["ignore", log, log] },
  );
  const exit = once(electron, "exit");
  const sampler = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      path.join(root, "scripts", "performance", "sample-memory.ps1"),
      "-RootPid",
      String(electron.pid),
      "-Output",
      path.join(output, "memory.jsonl"),
    ],
    { windowsHide: true },
  );
  const sampling = once(sampler, "exit");
  sampler.stdout.pipe(process.stdout);
  sampler.stderr.pipe(process.stderr);
  const [code] = await exit;
  fs.closeSync(log);
  const [sampleCode] = await sampling;
  process.exitCode = code || sampleCode;
  const resultFile = path.join(output, "panels.json");
  const result = fs.existsSync(resultFile)
    ? JSON.parse(fs.readFileSync(resultFile, "utf8"))
    : {
        config,
        checkpoints: [],
        errors: [],
        failure: `Electron exited (${code}) before reporting; see electron.log`,
      };
  result.electronExitCode = code;
  result.samplerExitCode = sampleCode;
  if (sampleCode) result.failure ||= `Native sampler exited (${sampleCode})`;
  const samplesFile = path.join(output, "memory.jsonl");
  if (!fs.existsSync(samplesFile) || !fs.statSync(samplesFile).size) {
    result.failure ||= "Native sampler captured no data";
  }
  if (result.failure) process.exitCode ||= 1;
  fs.writeFileSync(resultFile, JSON.stringify(result, null, 2));
  if (result.failure) console.error(result.failure);
  console.log(`Evidence: ${output}`);
} else {
  const { app } = await import("electron");
  const config = JSON.parse(fs.readFileSync(process.env.BERU_PANEL_MEMORY_CONFIG, "utf8"));
  app.setPath("userData", path.join(config.output, "profile"));
  process.env.BERU_DEV_URL = pathToFileURL(path.join(config.output, "build", "index.html")).href;
  const report = { config, started: Date.now(), checkpoints: [], errors: [], cycles: 0 };
  const watchdog = setTimeout(
    () => {
      report.failure = "Session exceeded its deadline";
      fs.writeFileSync(path.join(config.output, "panels.json"), JSON.stringify(report, null, 2));
      app.exit(1);
    },
    (config.minutes * 60 + 180) * 1000,
  );
  app.once("browser-window-created", async (_, win) => {
    const wc = win.webContents;
    wc.setBackgroundThrottling(false);
    wc.on("console-message", (_, level, message) => {
      if (level >= 3) report.errors.push(message);
    });
    wc.on("render-process-gone", (_, detail) => report.errors.push(detail.reason));
    wc.debugger.attach("1.3");
    const send = (method, params = {}) => wc.debugger.sendCommand(method, params);
    const evaluate = async (expression) => {
      const value = await send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (value.exceptionDetails)
        throw new Error(
          value.exceptionDetails.exception?.description || value.exceptionDetails.text,
        );
      return value.result.value;
    };
    const waitFor = (selector, present = true) =>
      evaluate(
        `(async()=>{const start=performance.now();while(Boolean(document.querySelector(${JSON.stringify(selector)}))!==${present}){if(performance.now()-start>20000)throw Error('Panel state timed out: '+${JSON.stringify(selector)});await new Promise(r=>setTimeout(r,50));}})()`,
      );
    const checkpoint = async (name) => {
      await delay(1000);
      const beforeGC = await send("Performance.getMetrics");
      await send("HeapProfiler.collectGarbage");
      const afterGC = await send("Performance.getMetrics");
      report.checkpoints.push({
        name,
        stamp: Date.now(),
        beforeGC,
        afterGC,
        dom: await send("Memory.getDOMCounters"),
        processes: app.getAppMetrics(),
        state: await evaluate(
          `({queue:__memoryAuditStore.getState().queue.length,rows:__memoryAuditStore.getState().excelRows.length,modals:document.querySelectorAll('.cap-modal-overlay').length,visibility:document.visibilityState})`,
        ),
      });
    };
    const close = () =>
      evaluate(
        `__memoryAuditStore.setState({showShortcuts:false,showWatermarkModal:false,showMappingModal:false,showTableEditor:false,showSettings:false,showPetPalette:false});undefined`,
      );
    try {
      await send("Performance.enable");
      await once(wc, "did-finish-load");
      win.show();
      await waitFor(".app-shell");
      await checkpoint("empty-before-panels");
      await evaluate(
        `window.api.restoreSessionPaths({videoPaths:[${JSON.stringify(config.source)}]})`,
      );
      await evaluate(
        `(()=>{const s=__memoryAuditStore;const regions=Array.from({length:10},(_,i)=>({id:i+1,label:'TEXT_'+i,region:{x:0.05,y:0.1+i*0.05,w:0.5,h:0.04},style:{fontSize:24,fontFamily:'Arial',fontColor:'white'}}));s.setState({queue:Array.from({length:${config.count}},(_,i)=>({id:'audit-'+i,path:${JSON.stringify(config.source)},filename:'clip-'+i+'.mp4',width:${config.video.width},height:${config.video.height},sourceWidth:${config.video.width},sourceHeight:${config.video.height},duration:${config.duration},status:'idle',operations:regions.map(r=>({id:i+'-'+r.id,mode:'text',text:'Audit '+i+' region '+r.id,region:r.region,fontSize:24,fontFamily:'Arial',fontColor:'white'}))})),selectedIdx:0,templateIdx:0,templateRegions:regions,excelHeaders:['id',...regions.map(r=>r.label)],excelRows:Array.from({length:5000},(_,i)=>Object.fromEntries([['id','clip-'+i],...regions.map(r=>[r.label,'Row '+i+' column '+r.id+' '+('x'.repeat(100))])])),excelMapping:{idColumn:'id',columns:Object.fromEntries(regions.map(r=>[r.id,r.label]))},excelPath:'audit-memory.xlsx'});})()`,
      );
      await checkpoint("large-project-before-panels");
      const panels = [
        ["shortcuts", "setShowShortcuts(true)", ".cap-modal-overlay"],
        ["watermark", "setShowWatermarkModal(true)", ".watermark-type-btn"],
        ["mapping", "setShowMappingModal(true)", ".cap-modal-overlay"],
        ["table", "setShowTableEditor(true)", ".table-editor"],
        ["settings", "openSettingsTab('appearance')", ".settings-appearance"],
        ...(config.includePalette
          ? [["palette", "setShowPetPalette(true)", ".pet-palette-modal"]]
          : []),
      ];
      const cycle = async (measure, emptyProject = false) => {
        for (const [name, expression, selector] of panels) {
          if (emptyProject && name === "table") continue;
          await evaluate(`__memoryAuditStore.getState().${expression};undefined`);
          await waitFor(selector);
          if (measure) await checkpoint(name + "-open");
          await close();
          await waitFor(".cap-modal-overlay", false);
          if (measure) await checkpoint(name + "-closed");
        }
        report.cycles++;
      };
      await cycle(true);
      await checkpoint("all-panels-closed");
      const deadline = Date.now() + config.minutes * 60000;
      let nextCheckpoint = Date.now() + 60000;
      while (Date.now() < deadline) {
        await cycle(false);
        await delay(5000);
        if (Date.now() >= nextCheckpoint) {
          await checkpoint("soak-" + report.cycles);
          nextCheckpoint = Date.now() + 60000;
        }
      }
      await checkpoint("soak-end");
      await evaluate(
        `__memoryAuditStore.getState().clearQueue();__memoryAuditStore.setState({excelRows:[],excelHeaders:[],excelPath:null,excelMapping:{idColumn:null,columns:{}},templateRegions:[]});undefined`,
      );
      await checkpoint("project-cleared-panels-retained");
      await cycle(false, true);
      await checkpoint("empty-project-panels-reopened");
      fs.writeFileSync(path.join(config.output, "end.png"), (await wc.capturePage()).toPNG());
      if (report.errors.length) throw new Error("Runtime errors recorded");
    } catch (error) {
      report.failure = error.stack;
    }
    clearTimeout(watchdog);
    report.ended = Date.now();
    fs.writeFileSync(path.join(config.output, "panels.json"), JSON.stringify(report, null, 2));
    const { disposePreviewFrameWorker } = await import("../../main/utils/preview-frame-cache.js");
    const { disposeJobWorker } = await import("../../main/utils/job-worker.js");
    disposePreviewFrameWorker();
    disposeJobWorker();
    app.exit(report.failure ? 1 : 0);
  });
  await import(pathToFileURL(path.join(root, "main", "main.js")).href);
}
