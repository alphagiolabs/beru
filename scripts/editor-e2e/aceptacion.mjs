import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { FFMPEG, probe, sleep, translations, waitUntil } from "./harness.mjs";
import { basicFixtures } from "./fixtures.mjs";
import { openEditorSpace, startSession } from "./session.mjs";
import { createReport } from "./report.mjs";

const SCENARIO = "aceptacion";
const es = translations("es");
const L = {
  railLabel: es["editor.railLabel"],
  import: es["editor.import"],
  useClip: es["editor.useClip"],
  saveAs: es["editor.saveAs"],
  open: es["editor.open"],
  export: es["editor.export"],
  addTitle: es["editor.addTitle"],
  exactFrame: es["editor.exactFrame"],
  canvas: es["editor.canvas"],
  speed: es["editor.speed"],
  seek: es["editor.seek"],
  rangeStart: es["editor.rangeStart"],
  rangeEnd: es["editor.rangeEnd"],
  textField: es["editor.overlay.text"],
};

const clipCount = (page) => page.evaluate(`document.querySelectorAll(".timeline-clip").length`);

function clickInCard(page, filename, text) {
  return page.evaluate(`(() => {
    const card = [...document.querySelectorAll(".editor-asset")].find(
      (li) => li.querySelector(".editor-asset-name")?.textContent === ${JSON.stringify(filename)},
    );
    const button = card && [...card.querySelectorAll("button")].find((b) => b.textContent.trim() === ${JSON.stringify(text)});
    if (!button) return false;
    button.click();
    return true;
  })()`);
}

async function pickOption(page, triggerLabel, optionText) {
  const opened = await page.evaluate(`(() => {
    const trigger = document.querySelector(${JSON.stringify(`[role="combobox"][aria-label="${triggerLabel}"]`)});
    if (!trigger) return false;
    trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    return true;
  })()`);
  if (!opened) throw new Error(`No select labelled ${triggerLabel}`);
  await waitUntil(
    () =>
      page.evaluate(
        `[...document.querySelectorAll('[role="option"]')].some((o) => o.textContent.trim() === ${JSON.stringify(optionText)})`,
      ),
    { timeout: 10000, label: `option ${optionText}` },
  );
  return page.evaluate(`(() => {
    const option = [...document.querySelectorAll('[role="option"]')].find((o) => o.textContent.trim() === ${JSON.stringify(optionText)});
    option?.click();
    return Boolean(option);
  })()`);
}

async function pressInEditor(page, key, options) {
  await page.evaluate("document.activeElement?.blur?.()");
  await page.pressKey(key, options);
}

const seekTo = (page, seconds) =>
  page.setInput('.editor-transport input[type="range"]', String(seconds));

async function exactFrameSource(page) {
  const src = await page.evaluate(`document.querySelector(".editor-exact-frame img")?.src ?? null`);
  if (!src) return null;
  return decodeURIComponent(new URL(src).pathname.replace(/^\//, ""));
}

function meanPixelDifference(pngA, pngB, width, height) {
  const raw = (file) =>
    execFileSync(FFMPEG, ["-v", "error", "-i", file, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], {
      maxBuffer: width * height * 3 * 2,
    });
  const a = raw(pngA);
  const b = raw(pngB);
  if (a.length !== b.length) return null;
  let total = 0;
  for (let i = 0; i < a.length; i += 1) total += Math.abs(a[i] - b[i]);
  return total / a.length;
}

function extractFrame(video, seconds, out) {
  execFileSync(FFMPEG, [
    "-v",
    "error",
    "-y",
    "-ss",
    String(seconds),
    "-i",
    video,
    "-frames:v",
    "1",
    out,
  ]);
  return out;
}

async function main() {
  const report = createReport(SCENARIO);
  const fixtures = basicFixtures();
  const media = path.join(report.dir, "media");
  fs.mkdirSync(media, { recursive: true });
  const a = path.join(media, "a.mp4");
  const b = path.join(media, "b.mp4");
  fs.copyFileSync(fixtures.a, a);
  fs.copyFileSync(fixtures.b, b);
  const project = path.join(report.dir, "aceptacion.beru-edit.json");
  const montage = path.join(report.dir, "montaje.mp4");
  const speedMontage = path.join(report.dir, "montaje-velocidad.mp4");
  for (const file of [project, montage, speedMontage]) fs.rmSync(file, { force: true });

  const started = Date.now();
  let session = await startSession(SCENARIO);
  let { page, main: host } = session;
  const dialogLog = [];
  try {
    await report.step("importar A y B por diálogo", async () => {
      await openEditorSpace(page, L);
      await host.queueOpen([a, b]);
      await page.click(L.import);
      await page.waitForText("a.mp4", { selector: ".editor-library", timeout: 60000 });
      await page.waitForText("b.mp4", { selector: ".editor-library", timeout: 60000 });
      await waitUntil(async () => (await clipCount(page)) === 1, { label: "A appended" });
      dialogLog.push(...(await host.dialogCalls()));
    });

    await report.step("A[1,6): recortar A a 1–6 s", async () => {
      await page.mouseClick(".timeline-clip");
      await page.setInput(".editor-range label:nth-child(1) input", "1");
      await page.setInput(".editor-range label:nth-child(2) input", "6");
      await page.waitForText("0:05.00", { selector: ".editor-timeline-head", timeout: 10000 });
      report.check("A dura 5 s en el montaje", true);
    });

    await report.step("B[0,5) después de A", async () => {
      report.check("añadir B al montaje", await clickInCard(page, "b.mp4", L.useClip));
      await waitUntil(async () => (await clipCount(page)) === 2, { label: "B appended" });
      await page.waitForText("0:10.00", { selector: ".editor-timeline-head", timeout: 10000 });
      report.check("el montaje dura 10 s con A y B", true);
    });

    await report.step("dividir en 3 s y deshacer", async () => {
      await seekTo(page, 3);
      await pressInEditor(page, "s");
      await waitUntil(async () => (await clipCount(page)) === 3, { label: "split" });
      await page.waitForText("0:10.00", { selector: ".editor-timeline-head", timeout: 10000 });
      report.check("dividir deja 3 fragmentos y 10 s", true);
      await pressInEditor(page, "z", { ctrlKey: true });
      await waitUntil(async () => (await clipCount(page)) === 2, { label: "undo" });
      report.check("deshacer vuelve a 2 fragmentos", true);
    });

    await report.step("reordenar: B pasa delante de A", async () => {
      const widthA = await page.evaluate(
        `document.querySelectorAll(".timeline-clip")[0].getBoundingClientRect().width`,
      );
      await page.mouseDrag('.timeline-clip[aria-label="b.mp4"]', -widthA * 1.1, 0);
      await waitUntil(
        () =>
          page.evaluate(
            `document.querySelectorAll(".timeline-clip")[0]?.getAttribute("aria-label") === "b.mp4"`,
          ),
        { timeout: 10000, label: "reorder" },
      );
      await page.waitForText("0:10.00", { selector: ".editor-timeline-head", timeout: 10000 });
      report.check("B queda primero y el montaje sigue en 10 s", true);
    });

    await report.step("canvas 9:16", async () => {
      report.check("elegir 9:16 en el lienzo", await pickOption(page, L.canvas, "9:16"));
      await waitUntil(
        () =>
          page.evaluate(
            `document.querySelector(".editor-canvas")?.style.getPropertyValue("--canvas-ratio") === "0.5625"`,
          ),
        { timeout: 10000, label: "9:16 applied" },
      );
    });

    await report.step("título de 2 a 4 s", async () => {
      await seekTo(page, 2);
      await page.click(L.addTitle);
      await page.setInput(".editor-range label:nth-child(2) input", "4");
      await page.setInput('.editor-overlay-style input[type="text"]', "Título E2E");
      await seekTo(page, 3);
      await waitUntil(
        () =>
          page.evaluate(
            `[...document.querySelectorAll(".editor-overlay-text")].some((t) => t.textContent === "Título E2E")`,
          ),
        { timeout: 10000, label: "title visible at 3 s" },
      );
      report.check("el título aparece en 3 s", true);
    });

    await report.step("guardar, cerrar y reabrir", async () => {
      await host.queueSave(project);
      await page.click(L.saveAs);
      await page.waitForText("Proyecto guardado: aceptacion.beru-edit.json", { timeout: 30000 });
      const saved = JSON.parse(fs.readFileSync(project, "utf8"));
      const title = saved.overlays?.find((overlay) => overlay.kind === "text");
      report.check(
        "el archivo guarda 2 clips y el título entre 2 y 4 s",
        saved.clips?.length === 2 && title?.startUs === 2_000_000 && title?.endUs === 4_000_000,
        JSON.stringify({
          clips: saved.clips?.length,
          title: title && [title.startUs, title.endUs],
        }),
      );
      dialogLog.push(...(await host.dialogCalls()));
      await session.stop();
      session = await startSession(`${SCENARIO}-reabrir`);
      ({ page, main: host } = session);
      await openEditorSpace(page, L);
      await host.queueOpen([project]);
      await page.click(L.open);
      await waitUntil(async () => (await clipCount(page)) === 2, {
        timeout: 60000,
        label: "reopened clips",
      });
      await seekTo(page, 3);
      await page.waitForText("Título E2E", { selector: ".editor-stage", timeout: 30000 });
      report.check("al reabrir siguen 2 clips y el título a 3 s", true);
    });

    await report.step("exportar el montaje a MP4 y comparar con la vista exacta", async () => {
      await host.queueSave(montage);
      await page.click(L.export);
      await page.waitForText("Exportación completada: montaje.mp4", { timeout: 300000 });
      const info = probe(montage);
      report.check(
        "el MP4 dura 10 s",
        Math.abs(info.durationS - 10) < 0.05,
        `${info.durationS.toFixed(3)} s`,
      );
      report.check(
        "el MP4 es 9:16 (1080×1920)",
        info.width === 1080 && info.height === 1920,
        `${info.width}×${info.height}`,
      );
      report.check("el MP4 tiene audio", info.hasAudio);

      await seekTo(page, 3);
      await page.click(L.exactFrame);
      await waitUntil(
        () =>
          page.evaluate(
            `Boolean(document.querySelector(".editor-exact-frame img")?.complete && document.querySelector(".editor-exact-frame img").naturalWidth > 0)`,
          ),
        { timeout: 120000, label: "exact frame at 3 s" },
      );
      const exactSource = await exactFrameSource(page);
      if (!exactSource || !fs.existsSync(exactSource)) {
        report.check(
          "la vista exacta se puede leer para comparar",
          false,
          `archivo: ${exactSource}`,
        );
      } else {
        const exactFile = path.join(report.dir, "vista-exacta-3s.png");
        fs.copyFileSync(exactSource, exactFile);
        const exportFile = extractFrame(montage, 3, path.join(report.dir, "montaje-3s.png"));
        const difference = meanPixelDifference(exactFile, exportFile, 1080, 1920);
        report.check(
          "la vista exacta y el MP4 coinciden a 3 s (diferencia media < 12)",
          difference !== null && difference < 12,
          `diferencia media ${difference?.toFixed(2)}`,
        );
      }
      dialogLog.push(...(await host.dialogCalls()));
    });

    await report.step("variante de velocidad: B a 2×", async () => {
      await page.mouseClick('.timeline-clip[aria-label="b.mp4"]');
      await pickOption(page, L.speed, "2×");
      await page.waitForText("0:07.50", { selector: ".editor-timeline-head", timeout: 10000 });
      await host.queueSave(speedMontage);
      await page.click(L.export);
      await page.waitForText("Exportación completada: montaje-velocidad.mp4", { timeout: 300000 });
      const info = probe(speedMontage);
      report.check(
        "con B a 2× el MP4 dura 7,5 s",
        Math.abs(info.durationS - 7.5) < 0.1,
        `${info.durationS.toFixed(3)} s`,
      );
    });

    report.check(
      "los diálogos fueron de importación, guardado, apertura y exportación",
      [
        "Importar videos al editor",
        "Guardar proyecto de edición",
        "Abrir proyecto de edición",
        "Exportar montaje a MP4",
      ].every((title) => dialogLog.some((call) => call.title === title)),
      dialogLog.map((call) => call.title).join(" | "),
    );
  } finally {
    report.check(
      "la pantalla no quedó con error visible",
      !(await page.evaluate(`Boolean(document.querySelector('[role="alert"]'))`)),
    );
    await session.stop();
  }
  const summary = report.finish();
  console.log(`elapsed ${((Date.now() - started) / 1000).toFixed(0)} s`);
  if (summary.failed > 0) process.exitCode = 1;
  await sleep(200);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
