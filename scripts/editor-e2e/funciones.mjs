import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { FFMPEG, RUN_ROOT, probe, translations, waitUntil } from "./harness.mjs";
import { basicFixtures, blackFixture, logoFixture } from "./fixtures.mjs";
import { openEditorSpace, startSession } from "./session.mjs";
import { createReport } from "./report.mjs";

const SCENARIO = process.env.BERU_E2E_APP ? "funciones-app-empaquetada" : "funciones";
const es = translations("es");
const L = {
  railLabel: es["editor.railLabel"],
  import: es["editor.import"],
  export: es["editor.export"],
  exactFrame: es["editor.exactFrame"],
  exactStale: es["editor.exactFrameStale"],
  recoverTitle: es["editor.recover.title"],
  recoverConfirm: es["editor.recover.confirm"],
  recoverDiscard: es["editor.recover.discard"],
  addTitle: es["editor.addTitle"],
  addImage: es["editor.addImage"],
  defaultTitle: es["editor.overlay.defaultText"],
};

const dir = path.join(RUN_ROOT, SCENARIO);
const media = path.join(dir, "media");

function copyFixture(source, name) {
  fs.mkdirSync(media, { recursive: true });
  const target = path.join(media, name);
  fs.copyFileSync(source, target);
  return target;
}

function frameRgb(file, seconds, width, height) {
  const buffer = execFileSync(
    FFMPEG,
    [
      "-v",
      "error",
      "-ss",
      String(seconds),
      "-i",
      file,
      "-frames:v",
      "1",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "-",
    ],
    { maxBuffer: 64 * 1024 * 1024, windowsHide: true },
  );
  if (buffer.length !== width * height * 3)
    throw new Error(`frame at ${seconds} s has ${buffer.length} bytes`);
  return buffer;
}

function countInBox(buffer, width, [x0, y0, x1, y1], test) {
  let count = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (y * width + x) * 3;
      if (test(buffer[i], buffer[i + 1], buffer[i + 2])) count += 1;
    }
  }
  return count;
}

const isWhite = (r, g, b) => r > 200 && g > 200 && b > 200;
const isRed = (r, g, b) => r > 200 && g < 80 && b < 80;

const countClips = (page) => page.evaluate(`document.querySelectorAll(".timeline-clip").length`);

async function exactFrameCase(report) {
  const source = copyFixture(basicFixtures().a, "a.mp4");
  const session = await startSession(`${SCENARIO}-vista`);
  const { page, main: host } = session;
  try {
    await openEditorSpace(page, L);
    await host.queueOpen([source]);
    await page.click(L.import);
    await page.waitForText("a.mp4", { selector: ".editor-library", timeout: 60000 });
    await waitUntil(async () => (await countClips(page)) === 1, { label: "auto-appended clip" });

    await report.step("la vista exacta muestra un fotograma del tamaño del lienzo", async () => {
      await page.click(L.exactFrame);
      await waitUntil(
        () =>
          page.evaluate(
            `Boolean(document.querySelector(".editor-exact-frame img")?.complete && document.querySelector(".editor-exact-frame img").naturalWidth > 0)`,
          ),
        { timeout: 60000, label: "exact frame image" },
      );
      const size = await page.evaluate(
        `(() => { const img = document.querySelector(".editor-exact-frame img"); return { w: img.naturalWidth, h: img.naturalHeight }; })()`,
      );
      report.check(
        "el fotograma exacto mide 640×360",
        size.w === 640 && size.h === 360,
        `${size.w}×${size.h}`,
      );
      await page.screenshot(path.join(dir, "vista-exacta.png"));
    });

    await report.step(
      "un cambio durante el render deja la vista marcada como desactualizada",
      async () => {
        await page.evaluate(`document.querySelector(".editor-exact-frame > button")?.click()`);
        await page.mouseClick(".timeline-clip");
        await page.click(L.exactFrame);
        await page.setInput(".editor-range label:nth-child(2) input", "5");
        await waitUntil(
          () =>
            page.evaluate(
              `(document.querySelector(".editor-exact-frame")?.innerText ?? "").includes(${JSON.stringify(L.exactStale)})`,
            ),
          { timeout: 60000, label: "stale notice" },
        );
        report.check("la vista marca el resultado como desactualizado", true, L.exactStale);
      },
    );
  } finally {
    await session.stop();
  }
}

async function autosaveCase(report) {
  const source = copyFixture(basicFixtures().a, "a.mp4");
  const profile = path.join(RUN_ROOT, `${SCENARIO}-autoguardado`, "profile");
  const autosave = path.join(profile, "editor-autosave.json");

  let session = await startSession(`${SCENARIO}-autoguardado`);
  await report.step("el autoguardado escribe el montaje sin guardar", async () => {
    await openEditorSpace(session.page, L);
    await session.main.queueOpen([source]);
    await session.page.click(L.import);
    await session.page.waitForText("a.mp4", { selector: ".editor-library", timeout: 60000 });
    await session.page.mouseClick(".timeline-clip");
    await session.page.setInput(".editor-range label:nth-child(1) input", "1");
    await session.page.setInput(".editor-range label:nth-child(2) input", "6");
    await waitUntil(() => fs.existsSync(autosave), { timeout: 20000, label: "autosave file" });
    const saved = JSON.parse(fs.readFileSync(autosave, "utf8"));
    const clip = saved.project?.clips?.[0];
    report.check(
      "el archivo de autoguardado es beru-edit-autosave con el recorte",
      saved.type === "beru-edit-autosave" &&
        clip?.sourceInUs === 1_000_000 &&
        clip?.sourceOutUs === 6_000_000,
      `${saved.type}, ${clip?.sourceInUs}–${clip?.sourceOutUs}`,
    );
  });
  await session.stop();
  report.check("el autoguardado sobrevive al cierre de la app", fs.existsSync(autosave));

  session = await startSession(`${SCENARIO}-autoguardado`, { keepProfile: true });
  await report.step("recuperar el montaje al reabrir", async () => {
    await openEditorSpace(session.page, L);
    await session.page.waitForText(L.recoverTitle, { timeout: 60000 });
    await session.page.click(L.recoverConfirm);
    await session.page.waitForText("0:05.00", {
      selector: ".editor-timeline-head",
      timeout: 30000,
    });
    report.check(
      "el montaje recuperado tiene el recorte de 5 s",
      (await countClips(session.page)) === 1,
    );
  });
  await session.stop();

  session = await startSession(`${SCENARIO}-autoguardado`, { keepProfile: true });
  await report.step("descartar el autoguardado al reabrir", async () => {
    await openEditorSpace(session.page, L);
    await session.page.waitForText(L.recoverTitle, { timeout: 60000 });
    await session.page.click(L.recoverDiscard);
    await waitUntil(() => !fs.existsSync(autosave), { timeout: 20000, label: "autosave removed" });
    report.check("descartar borra el autoguardado", !fs.existsSync(autosave));
    report.check("el montaje queda vacío tras descartar", (await countClips(session.page)) === 0);
  });
  await session.stop();
}

async function overlayCase(report) {
  const source = copyFixture(blackFixture(), "negro.mp4");
  const logo = copyFixture(logoFixture(), "logo-red.png");
  const output = path.join(dir, "titulos.mp4");
  fs.rmSync(output, { force: true });
  const session = await startSession(`${SCENARIO}-titulos`);
  const { page, main: host } = session;
  try {
    await openEditorSpace(page, L);
    await host.queueOpen([source]);
    await page.click(L.import);
    await page.waitForText("negro.mp4", { selector: ".editor-library", timeout: 60000 });
    await waitUntil(async () => (await countClips(page)) === 1, { label: "auto-appended clip" });

    await report.step("añadir un título y editar su texto", async () => {
      await page.click(L.addTitle, ".editor-timeline-head");
      await page.waitForText(L.defaultTitle, { selector: ".editor-timeline", timeout: 10000 });
      await page.setInput('.editor-overlay-style input[type="text"]', "Hola montaje");
      await waitUntil(
        () =>
          page.evaluate(
            `[...document.querySelectorAll(".editor-overlay-text")].some((el) => el.textContent === "Hola montaje")`,
          ),
        { timeout: 10000, label: "title preview" },
      );
      report.check("el título aparece en la vista previa con el texto editado", true);
    });

    await report.step("añadir una capa de imagen", async () => {
      await host.queueOpen([logo]);
      await page.click(L.addImage, ".editor-timeline-head");
      await waitUntil(
        () =>
          page.evaluate(
            `Boolean(document.querySelector(".editor-overlay-image")?.complete && document.querySelector(".editor-overlay-image").naturalWidth > 0)`,
          ),
        { timeout: 30000, label: "logo preview" },
      );
      report.check("el logo aparece en la vista previa", true);
    });

    await report.step("exportar y comprobar los píxeles del MP4", async () => {
      await host.queueSave(output);
      await page.click(L.export);
      await page.waitForText("Exportación completada: titulos.mp4", { timeout: 300000 });
      const info = probe(output);
      report.check(
        "el MP4 dura 6 s",
        Math.abs(info.durationS - 6) < 0.2,
        `${info.durationS.toFixed(2)} s`,
      );
      const width = info.width;
      const height = info.height;
      const titleBox = [
        Math.round(width * 0.1),
        Math.round(height * 0.4),
        Math.round(width * 0.9),
        Math.round(height * 0.6),
      ];
      const logoBox = [
        Math.round(width * 0.7),
        Math.round(height * 0.05),
        Math.round(width * 0.7) + 90,
        Math.round(height * 0.05) + 90,
      ];
      const early = frameRgb(output, 1, width, height);
      const late = frameRgb(output, 4.5, width, height);
      const titleEarly = countInBox(early, width, titleBox, isWhite);
      const logoEarly = countInBox(early, width, logoBox, isRed);
      const titleLate = countInBox(late, width, titleBox, isWhite);
      const logoLate = countInBox(late, width, logoBox, isRed);
      report.metric("píxeles blancos del título a 1 s", titleEarly);
      report.metric("píxeles rojos del logo a 1 s", logoEarly);
      report.check("a 1 s el título está dibujado", titleEarly > 50, `${titleEarly} píxeles`);
      report.check(
        "a 1 s el logo está dibujado en su caja",
        logoEarly > 1000,
        `${logoEarly} píxeles`,
      );
      report.check(
        "a 4,5 s ya no hay título ni logo",
        titleLate < 5 && logoLate < 5,
        `título ${titleLate}, logo ${logoLate}`,
      );
    });
  } finally {
    await session.stop();
  }
}

async function main() {
  const report = createReport(SCENARIO);
  await report.step("vista exacta", () => exactFrameCase(report));
  await report.step("autoguardado y recuperación", () => autosaveCase(report));
  await report.step("títulos y logos en la exportación", () => overlayCase(report));
  const summary = report.finish();
  if (summary.failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
