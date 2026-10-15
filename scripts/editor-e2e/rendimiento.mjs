import fs from "node:fs";
import path from "node:path";
import { addAsset, insertClip, setCanvas } from "../../shared/editor-timeline.js";
import { createEmptyEditorProject } from "../../shared/editor-project.js";
import { RUN_ROOT, ffmpeg, probe, sleep, translations, waitUntil } from "./harness.mjs";
import { openEditorSpace, startSession } from "./session.mjs";
import { createReport } from "./report.mjs";

const SCENARIO = "rendimiento";
const PERF_MEDIA = path.join(RUN_ROOT, "perf", "media");
const es = translations("es");
const L = {
  railLabel: es["editor.railLabel"],
  import: es["editor.import"],
  open: es["editor.open"],
  export: es["editor.export"],
};

const SECOND = 1_000_000;

function makeMedia() {
  fs.mkdirSync(PERF_MEDIA, { recursive: true });
  const files = [];
  for (let i = 1; i <= 20; i += 1) {
    const file = path.join(PERF_MEDIA, `src-${String(i).padStart(2, "0")}.mp4`);
    if (!fs.existsSync(file)) {
      ffmpeg([
        "-f",
        "lavfi",
        "-i",
        `testsrc2=size=640x360:rate=30:duration=3`,
        "-f",
        "lavfi",
        "-i",
        `sine=frequency=${200 + i * 30}:duration=3`,
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-shortest",
        file,
      ]);
    }
    files.push(file);
  }
  const long = path.join(PERF_MEDIA, "larga-5min.mp4");
  if (!fs.existsSync(long)) {
    ffmpeg([
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=640x360:rate=30:duration=300",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=262:duration=300",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-crf",
      "40",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-shortest",
      long,
    ]);
  }
  const uhd = path.join(PERF_MEDIA, "uhd-4k-10s.mp4");
  if (!fs.existsSync(uhd)) {
    ffmpeg([
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=3840x2160:rate=30:duration=10",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-crf",
      "35",
      "-pix_fmt",
      "yuv420p",
      uhd,
    ]);
  }
  return { sources: files, long, uhd };
}

function writeProject(file, { sources, clips, name }) {
  let project = createEmptyEditorProject({ name });
  project = setCanvas(project, { width: 640, height: 360 });
  const assetIds = new Map();
  for (const source of sources) {
    const info = probe(source.path);
    const added = addAsset(project, {
      path: source.path,
      filename: path.basename(source.path),
      sizeBytes: fs.statSync(source.path).size,
      mtimeMs: fs.statSync(source.path).mtimeMs,
      metadata: {
        durationUs: Math.round(info.durationS * SECOND),
        width: info.width,
        height: info.height,
        hasAudio: info.hasAudio,
      },
    });
    project = added.project;
    assetIds.set(source.path, added.assetId);
  }
  for (const clip of clips) {
    project = insertClip(project, {
      assetId: assetIds.get(clip.path),
      sourceInUs: clip.inUs,
      sourceOutUs: clip.outUs,
    }).project;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(project, null, 2));
  return file;
}

async function heapMB(page) {
  await page.cdp.send("HeapProfiler.collectGarbage");
  const { usedSize } = await page.cdp.send("Runtime.getHeapUsage");
  return usedSize / (1024 * 1024);
}

async function timed(fn) {
  const started = Date.now();
  const value = await fn();
  return { value, ms: Date.now() - started };
}

async function main() {
  const report = createReport(SCENARIO);
  const media = makeMedia();
  const runDir = report.dir;
  const hundred = [];
  for (let i = 0; i < 100; i += 1) {
    const source = media.sources[i % 20];
    const inUs = (i % 5) * 500_000;
    hundred.push({ path: source, inUs, outUs: inUs + 500_000 });
  }
  const projectHundred = writeProject(path.join(runDir, "proyecto-100.beru-edit.json"), {
    sources: media.sources.map((p) => ({ path: p })),
    clips: hundred,
    name: "cien-clips",
  });
  const projectLong = writeProject(path.join(runDir, "proyecto-larga.beru-edit.json"), {
    sources: [{ path: media.long }],
    clips: [{ path: media.long, inUs: 120 * SECOND, outUs: 150 * SECOND }],
    name: "larga",
  });
  const montage100 = path.join(runDir, "montaje-100.mp4");
  const montageLong = path.join(runDir, "montaje-larga.mp4");
  for (const file of [montage100, montageLong]) fs.rmSync(file, { force: true });

  const session = await startSession(SCENARIO);
  const { page, main: host } = session;
  try {
    await report.step("abrir el espacio Editor", () => openEditorSpace(page, L));

    await report.step("sondear 20 fuentes por IPC, sin interfaz", async () => {
      const { ms, value } = await timed(() =>
        page.evaluate(
          `window.api.importEditorVideos({ paths: ${JSON.stringify(media.sources)} }).then((r) => ({ sources: r.sources.length, errors: r.errors.length }))`,
        ),
      );
      report.metric("sondear 20 fuentes por IPC, sin interfaz", ms, "ms");
      report.check(
        "las 20 fuentes se sondean sin error",
        value.sources === 20 && value.errors === 0,
        JSON.stringify(value),
      );
    });

    await report.step("importar 20 fuentes", async () => {
      await host.queueOpen(media.sources);
      const { ms } = await timed(async () => {
        await page.click(L.import);
        await page.waitForText("src-20.mp4", { selector: ".editor-library", timeout: 300000 });
      });
      report.metric("importar 20 fuentes", ms, "ms");
    });

    await report.step("abrir un proyecto de 100 clips tres veces", async () => {
      const heaps = [];
      const times = [];
      for (let round = 1; round <= 3; round += 1) {
        await host.queueOpen([projectHundred]);
        const { ms } = await timed(async () => {
          await page.click(L.open);
          await page.waitForText("0:50.00", { selector: ".editor-timeline-head", timeout: 300000 });
        });
        times.push(ms);
        heaps.push(await heapMB(page));
        await sleep(1000);
      }
      report.metric("abrir proyecto de 100 clips (primera vez)", times[0], "ms");
      report.metric("abrir proyecto de 100 clips (tercera vez)", times[2], "ms");
      report.metric(
        "heap de renderer tras cada apertura",
        heaps.map((h) => Number(h.toFixed(1))).join(" → "),
        "MB",
      );
      const growth = heaps[2] - heaps[0];
      report.check(
        "el heap del renderer no crece entre aperturas repetidas",
        growth < 25,
        `crecimiento ${growth.toFixed(1)} MB`,
      );
      report.metric(
        "memoria del proceso principal",
        (await host.memory()).rss / (1024 * 1024),
        "MB RSS",
      );
    });

    await report.step("exportar el montaje de 100 clips", async () => {
      await host.queueSave(montage100);
      const { ms } = await timed(async () => {
        await page.click(L.export);
        await page.waitForText("Exportación completada: montaje-100.mp4", { timeout: 900000 });
      });
      report.metric("exportar 100 clips (50 s de montaje)", ms, "ms");
      const info = probe(montage100);
      report.check(
        "el MP4 de 100 clips dura 50 s",
        Math.abs(info.durationS - 50) < 0.5,
        `duración=${info.durationS.toFixed(2)} s`,
      );
      report.check("el MP4 de 100 clips mide 640×360", info.width === 640 && info.height === 360);
    });

    await report.step("abrir un proyecto con una fuente de 5 minutos", async () => {
      const before = await heapMB(page);
      await host.queueOpen([projectLong]);
      const { ms } = await timed(async () => {
        await page.click(L.open);
        await page.waitForText("0:30.00", { selector: ".editor-timeline-head", timeout: 300000 });
      });
      const after = await heapMB(page);
      report.metric("abrir proyecto con fuente de 5 min", ms, "ms");
      report.metric(
        "heap del renderer al abrir fuente de 5 min",
        after - before,
        "MB de incremento",
      );
      report.check(
        "la fuente larga no se carga entera en el renderer",
        after - before < 120,
        `incremento ${(after - before).toFixed(1)} MB`,
      );
    });

    await report.step("exportar 30 s de la fuente de 5 minutos", async () => {
      await host.queueSave(montageLong);
      const { ms } = await timed(async () => {
        await page.click(L.export);
        await page.waitForText("Exportación completada: montaje-larga.mp4", { timeout: 900000 });
      });
      report.metric("exportar 30 s de fuente de 5 min", ms, "ms");
      const info = probe(montageLong);
      report.check(
        "el MP4 de la fuente larga dura 30 s",
        Math.abs(info.durationS - 30) < 0.2,
        `duración=${info.durationS.toFixed(2)} s`,
      );
    });

    await report.step("generar el proxy de vista previa de una fuente 4K", async () => {
      const source = await page.evaluate(`(async () => {
        const result = await window.api.importEditorVideos({ paths: [${JSON.stringify(media.uhd)}] });
        return result.sources[0];
      })()`);
      report.check(
        "la fuente 4K se importa con sus dimensiones",
        source?.metadata?.width === 3840 && source?.metadata?.height === 2160,
        `${source?.metadata?.width}×${source?.metadata?.height}`,
      );
      const identity = {
        path: source.path,
        sizeBytes: source.sizeBytes,
        mtimeMs: source.mtimeMs,
        durationUs: source.metadata.durationUs,
      };
      const { ms, value } = await timed(() =>
        page.evaluate(
          `window.api.createEditorPreviewProxy({ source: ${JSON.stringify(identity)} })`,
        ),
      );
      report.metric("proxy de vista previa de 4K (10 s)", ms, "ms");
      if (value?.success) {
        const info = probe(value.path);
        report.check(
          "el proxy es de 960×540",
          info.width === 960 && info.height === 540,
          `${info.width}×${info.height}`,
        );
        report.check(
          "el proxy conserva la duración",
          Math.abs(info.durationS - 10) < 0.3,
          `duración=${info.durationS.toFixed(2)} s`,
        );
      } else {
        report.check("el proxy de 4K se genera", false, value?.error ?? "sin respuesta");
      }
    });
  } finally {
    await session.stop();
  }
  const summary = report.finish();
  if (summary.failed > 0) process.exitCode = 1;
  return waitUntil;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
