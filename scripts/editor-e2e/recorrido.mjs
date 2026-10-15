import fs from "node:fs";
import path from "node:path";
import { probe, sleep, translations, waitUntil } from "./harness.mjs";
import { basicFixtures } from "./fixtures.mjs";
import { openEditorSpace, startSession } from "./session.mjs";
import { createReport } from "./report.mjs";

const SCENARIO = process.env.BERU_E2E_APP ? "recorrido-app-empaquetada" : "recorrido";
const es = translations("es");
const L = {
  railLabel: es["editor.railLabel"],
  import: es["editor.import"],
  useClip: es["editor.useClip"],
  saveAs: es["editor.saveAs"],
  open: es["editor.open"],
  export: es["editor.export"],
  relink: es["editor.relink"],
};

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

function cardStatus(page, filename) {
  return page.evaluate(`(() => {
    const card = [...document.querySelectorAll(".editor-asset")].find(
      (li) => li.querySelector(".editor-asset-name")?.textContent === ${JSON.stringify(filename)},
    );
    return card?.querySelector(".editor-muted")?.textContent ?? "";
  })()`);
}

const hasStatus = async (page, filename, status) =>
  (await cardStatus(page, filename)).includes(status);

const cardStatus_ = (selector) =>
  `document.querySelector(${JSON.stringify(selector)})?.textContent ?? ""`;

const clipCount = (page) => page.evaluate(`document.querySelectorAll(".timeline-clip").length`);

async function main() {
  const report = createReport(SCENARIO);
  const fixtures = basicFixtures();
  const media = path.join(report.dir, "media");
  fs.mkdirSync(media, { recursive: true });
  const a = path.join(media, "a.mp4");
  const b = path.join(media, "b.mp4");
  fs.copyFileSync(fixtures.a, a);
  fs.copyFileSync(fixtures.b, b);
  const project = path.join(report.dir, "proyecto.beru-edit.json");
  const montage = path.join(report.dir, "montaje.mp4");
  const montageAfterRelink = path.join(report.dir, "montaje-relink.mp4");
  const moved = path.join(media, "a-movido.mp4");
  fs.rmSync(project, { force: true });
  fs.rmSync(montage, { force: true });
  fs.rmSync(montageAfterRelink, { force: true });

  const session = await startSession(SCENARIO);
  const { page, main: host } = session;
  const dialogLog = [];
  const started = Date.now();
  try {
    await report.step("abrir el espacio Editor", () => openEditorSpace(page, L));
    report.check(
      "el espacio Editor muestra Importar",
      await page.waitForButton(L.import, { timeout: 5000 }).then(
        () => true,
        () => false,
      ),
    );

    await report.step("importar dos videos por diálogo", async () => {
      await host.queueOpen([a, b]);
      await page.click(L.import);
      await page.waitForText("a.mp4", { selector: ".editor-library", timeout: 60000 });
      await page.waitForText("b.mp4", { selector: ".editor-library", timeout: 60000 });
      const calls = await host.dialogCalls();
      dialogLog.push(...calls);
      report.check(
        "el diálogo de importación se pidió una vez",
        calls.filter((c) => c.type === "open").length === 1,
        JSON.stringify(calls),
      );
    });

    await report.step("el primer video importado entra solo al montaje", async () => {
      await waitUntil(async () => (await clipCount(page)) === 1, { label: "auto-appended clip" });
      report.check("el montaje tiene un clip tras importar", true);
    });

    await report.step("seleccionar el clip de a.mp4 y recortar su rango a 1 s–6 s", async () => {
      await page.mouseClick(".timeline-clip");
      await page.setInput(".editor-range label:nth-child(1) input", "1");
      await page.setInput(".editor-range label:nth-child(2) input", "6");
      await page.waitForText("0:05.00", { selector: ".editor-timeline-head", timeout: 10000 });
      report.check("el montaje dura 5 s tras recortar", true);
    });

    await report.step("añadir b.mp4 y comprobar 10 s en total", async () => {
      report.check("añadir b.mp4 al montaje", await clickInCard(page, "b.mp4", L.useClip));
      await waitUntil(async () => (await clipCount(page)) === 2, { label: "second clip" });
      await page.waitForText("0:10.00", { selector: ".editor-timeline-head", timeout: 10000 });
    });

    await report.step("guardar como proyecto", async () => {
      await host.queueSave(project);
      await page.click(L.saveAs);
      await page.waitForText("Proyecto guardado: proyecto.beru-edit.json", { timeout: 30000 });
      const saved = JSON.parse(fs.readFileSync(project, "utf8"));
      report.check(
        "el archivo guardado es un beru-edit-project con 2 clips",
        saved.type === "beru-edit-project" && saved.clips.length === 2,
        `clips=${saved.clips?.length}`,
      );
    });

    await report.step("exportar el montaje a MP4", async () => {
      await host.queueSave(montage);
      await page.click(L.export);
      await page.waitForText("Exportación completada: montaje.mp4", { timeout: 300000 });
      const info = probe(montage);
      report.check(
        "el MP4 dura 10 s",
        Math.abs(info.durationS - 10) < 0.2,
        `duración=${info.durationS.toFixed(2)} s`,
      );
      report.check(
        "el MP4 conserva el lienzo de la primera fuente (640×360)",
        info.width === 640 && info.height === 360,
        `${info.width}×${info.height}`,
      );
      report.check("el MP4 tiene pista de audio", info.hasAudio);
    });

    await report.step("mover a.mp4 y reabrir el proyecto", async () => {
      fs.renameSync(a, moved);
      await host.queueOpen([project]);
      await page.click(L.open);
      await waitUntil(() => hasStatus(page, "a.mp4", "Archivo no encontrado"), {
        timeout: 30000,
        label: "missing status",
      });
      report.check("a.mp4 aparece como archivo no encontrado tras reabrir", true);
      report.check("b.mp4 sigue listo", await hasStatus(page, "b.mp4", "Listo"));
      report.check("el montaje conserva sus dos clips", (await clipCount(page)) === 2);
    });

    await report.step("buscar el archivo movido y volver a exportar", async () => {
      await host.queueOpen([moved]);
      report.check("buscar archivo relinka a.mp4", await clickInCard(page, "a.mp4", L.relink));
      await waitUntil(() => hasStatus(page, "a-movido.mp4", "Listo"), {
        timeout: 30000,
        label: "relinked status",
      }).catch(async (error) => {
        const detail = await page.evaluate(
          `(document.querySelector(".app-toast-layer")?.textContent ?? "") + " | card: " + (${cardStatus_(".editor-asset")})`,
        );
        throw new Error(`${error.message}; toast/card: ${detail}`);
      });
      await host.queueSave(montageAfterRelink);
      await page.click(L.export);
      await page.waitForText("Exportación completada: montaje-relink.mp4", { timeout: 300000 });
      const info = probe(montageAfterRelink);
      report.check(
        "la exportación tras relinkar dura 10 s",
        Math.abs(info.durationS - 10) < 0.2,
        `duración=${info.durationS.toFixed(2)} s`,
      );
      dialogLog.push(...(await host.dialogCalls()));
      report.check(
        "los diálogos fueron de importación, guardado, apertura, búsqueda y exportación",
        [
          "Importar videos al editor",
          "Guardar proyecto de edición",
          "Abrir proyecto de edición",
          "Buscar video",
          "Exportar montaje a MP4",
        ].every((title) => dialogLog.some((c) => c.title === title)),
        dialogLog.map((c) => c.title).join(" | "),
      );
    });
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
