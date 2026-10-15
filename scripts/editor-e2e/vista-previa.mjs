import fs from "node:fs";
import path from "node:path";
import { probe, sleep, translations, waitUntil } from "./harness.mjs";
import { basicFixtures } from "./fixtures.mjs";
import { openEditorSpace, startSession } from "./session.mjs";
import { createReport } from "./report.mjs";
import {
  addAsset,
  addTextOverlay,
  insertClip,
  setCanvas,
  setClipTransform,
  updateOverlay,
} from "../../shared/editor-timeline.js";
import { createEmptyEditorProject } from "../../shared/editor-project.js";
import { clipLayerGeometry } from "../../shared/clip-transform.js";

const SCENARIO = "vista-previa";
const SECOND = 1_000_000;
const es = translations("es");
const L = {
  railLabel: es["editor.railLabel"],
  import: es["editor.import"],
  open: es["editor.open"],
  exactFrame: es["editor.exactFrame"],
};
const CANVAS = { width: 1080, height: 1920 };
const TRANSFORM = {
  rotate: 90,
  flipH: true,
  crop: { x: 0.1, y: 0, w: 0.8, h: 1 },
  zoom: 1.4,
  offsetX: 0.05,
  offsetY: 0,
  fit: "fill",
};
const TITLE_STYLE = {
  color: "#ffcc00",
  size: 0.07,
  fontFamily: "Segoe UI",
  bold: true,
  italic: true,
  textAlign: "right",
  textOpacity: 0.9,
  borderWidth: 0.08,
  borderColor: "#ff0000",
  textShadowEnabled: true,
  textShadowColor: "#000000",
  bgEnabled: true,
  bgColor: "#102030",
  bgOpacity: 0.6,
};

function writeProject(file, source) {
  let project = setCanvas(createEmptyEditorProject({ name: "vista previa" }), CANVAS);
  const info = probe(source);
  const added = addAsset(project, {
    path: source,
    filename: path.basename(source),
    sizeBytes: fs.statSync(source).size,
    mtimeMs: fs.statSync(source).mtimeMs,
    metadata: {
      durationUs: Math.round(info.durationS * SECOND),
      width: info.width,
      height: info.height,
      hasAudio: info.hasAudio,
    },
  });
  project = insertClip(added.project, {
    assetId: added.assetId,
    sourceInUs: 0,
    sourceOutUs: 5 * SECOND,
  }).project;
  const clipId = project.clips[0].id;
  project = setClipTransform(project, clipId, TRANSFORM);
  const title = addTextOverlay(project, {
    startUs: SECOND,
    endUs: 4 * SECOND,
    text: "Título\nsegunda línea",
  });
  project = updateOverlay(title.project, title.overlayId, {
    geometry: { x: 0.1, y: 0.62, w: 0.8, h: 0.24 },
    style: TITLE_STYLE,
  });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(project, null, 2));
  return project;
}

const READ_FRAME = `(() => {
  const canvas = document.querySelector(".editor-canvas").getBoundingClientRect();
  const frame = document.querySelector(".editor-clip-frame.is-active");
  const video = frame?.querySelector(".editor-video");
  if (!frame || !video) return null;
  const rect = frame.getBoundingClientRect();
  const text = document.querySelector(".editor-overlay-text");
  const style = text ? getComputedStyle(text) : null;
  return {
    canvasWidth: canvas.width,
    frame: { left: rect.left - canvas.left, top: rect.top - canvas.top, width: rect.width, height: rect.height },
    matrix: video.style.transform,
    title: style && {
      fontWeight: style.fontWeight,
      textAlign: style.textAlign,
      fontStyle: style.fontStyle,
      textShadow: style.textShadow,
      strokeWidth: style.webkitTextStrokeWidth,
      background: style.backgroundColor,
    },
  };
})()`;

function parseMatrix(text) {
  const values = text
    .match(/matrix\(([^)]+)\)/)?.[1]
    .split(",")
    .map(Number);
  return values;
}

async function main() {
  const report = createReport(SCENARIO);
  const fixtures = basicFixtures();
  const media = path.join(report.dir, "media");
  fs.mkdirSync(media, { recursive: true });
  const source = path.join(media, "a.mp4");
  fs.copyFileSync(fixtures.a, source);
  const project = path.join(report.dir, "vista-previa.beru-edit.json");
  const saved = writeProject(project, source);
  const clip = saved.clips[0];
  const sourceSize = probe(source);
  const expected = clipLayerGeometry(
    clip.transform,
    { width: sourceSize.width, height: sourceSize.height },
    CANVAS,
  );

  const started = Date.now();
  const session = await startSession(SCENARIO);
  const { page, main: host } = session;
  try {
    await report.step("abrir el proyecto con transformaciones y un título", async () => {
      await openEditorSpace(page, L);
      await host.queueOpen([project]);
      await page.click(L.open);
      await page
        .waitForText("0:04.00", { selector: ".editor-timeline-head", timeout: 60000 })
        .catch(() => {});
      await waitUntil(
        () =>
          page.evaluate(
            `Boolean(document.querySelector(".editor-clip-frame.is-active .editor-video"))`,
          ),
        {
          timeout: 60000,
          label: "active frame",
        },
      );
      await page.setInput('.editor-transport input[type="range"]', "1.5");
      await waitUntil(
        () => page.evaluate(`Boolean(document.querySelector(".editor-overlay-text"))`),
        { timeout: 30000, label: "title" },
      );
      await sleep(400);
    });

    await report.step(
      "la capa del clip ocupa el lugar que fija la geometría compartida",
      async () => {
        const state = await page.evaluate(READ_FRAME);
        const scale = state.canvasWidth / CANVAS.width;
        const got = state.frame;
        const want = expected.frame;
        const near = (a, b) => Math.abs(a - b) <= 2;
        report.check(
          "izquierda, arriba, ancho y alto del marco coinciden con la exportación",
          near(got.left, want.left * scale) &&
            near(got.top, want.top * scale) &&
            near(got.width, want.width * scale) &&
            near(got.height, want.height * scale),
          JSON.stringify({ got, want: { ...want, scale } }),
        );
        const applied = parseMatrix(state.matrix);
        const planned = expected.matrix;
        report.check(
          "la matriz de la imagen coincide con la de la geometría",
          applied &&
            applied.every(
              (value, i) =>
                Math.abs(value - planned[i]) <= 0.01 * Math.max(1, Math.abs(planned[i])),
            ),
          `${state.matrix} | esperada: ${planned.map((v) => v.toFixed(3)).join(", ")}`,
        );
      },
    );

    await report.step("el título usa sus opciones de texto", async () => {
      const { title } = await page.evaluate(READ_FRAME);
      report.check(
        "negrita y cursiva",
        title.fontWeight === "700" && title.fontStyle === "italic",
        JSON.stringify(title),
      );
      report.check("alineación a la derecha", title.textAlign === "right", title.textAlign);
      report.check(
        "fondo y contorno y sombra",
        title.background !== "none" && title.strokeWidth !== "0px" && title.textShadow !== "none",
        JSON.stringify(title),
      );
    });

    await report.step("guardar capturas de la vista en vivo y de la vista exacta", async () => {
      await page.screenshot(path.join(report.dir, "vista-en-vivo.png"));
      await page.click(L.exactFrame);
      await waitUntil(
        () =>
          page.evaluate(
            `Boolean(document.querySelector(".editor-exact-frame img")?.complete && document.querySelector(".editor-exact-frame img").naturalWidth > 0)`,
          ),
        { timeout: 120000, label: "exact frame" },
      );
      const exactSource = decodeURIComponent(
        new URL(
          await page.evaluate(`document.querySelector(".editor-exact-frame img").src`),
        ).pathname.replace(/^\//, ""),
      );
      fs.copyFileSync(exactSource, path.join(report.dir, "vista-exacta.png"));
      report.check(
        "la vista exacta mide el lienzo 1080×1920",
        probe(exactSource).width === 1080 && probe(exactSource).height === 1920,
      );
      await page.screenshot(path.join(report.dir, "vista-exacta-pantalla.png"));
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
