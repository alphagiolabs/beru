import path from "node:path";
import { RUN_ROOT, translations, waitUntil } from "./harness.mjs";
import { openEditorSpace, startSession } from "./session.mjs";
import { createReport } from "./report.mjs";

const LANG = process.env.BERU_E2E_LANG === "en" ? "en" : "es";
const SCENARIO = `accesibilidad-${LANG}`;
const themePrefix = LANG === "en" ? "Switch to" : "Cambiar a";
const messages = translations(LANG);
const L = {
  railLabel: messages["editor.railLabel"],
  import: messages["editor.import"],
};

const AUDIT = `(() => {
  const space = document.querySelector(".editor-workspace");
  if (!space) return { missing: true };
  const nameOf = (el) => el.getAttribute("aria-label") || el.textContent.trim() || el.getAttribute("title") || "";
  const unnamedButtons = [...space.querySelectorAll("button")]
    .filter((b) => b.offsetParent !== null && !nameOf(b))
    .map((b) => b.outerHTML.slice(0, 80));
  const unlabelledFields = [...space.querySelectorAll("input, select, textarea")]
    .filter((el) => el.offsetParent !== null && el.type !== "hidden")
    .filter((el) => !el.getAttribute("aria-label") && !el.closest("label") && !(el.id && document.querySelector('label[for="' + el.id + '"]')))
    .map((el) => el.outerHTML.slice(0, 80));
  return { buttons: space.querySelectorAll("button").length, unnamedButtons, fields: space.querySelectorAll("input, select, textarea").length, unlabelledFields };
})()`;

const TAB_WALK = (step) => `(() => {
  const el = document.activeElement;
  if (!el || el === document.body) return { step: ${step}, element: "body", visible: false };
  const style = getComputedStyle(el);
  const visible = (style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0) || style.boxShadow !== "none";
  const name = el.getAttribute("aria-label") || el.textContent.trim().slice(0, 40) || el.getAttribute("title") || el.tagName.toLowerCase();
  return { step: ${step}, element: name, visible };
})()`;

const STAGE_HINT_CONTRAST = `(() => {
  const el = document.querySelector(".editor-stage-message span");
  if (!el) return null;
  const channels = (css) => css.match(/[0-9.]+/g).slice(0, 3).map(Number);
  const linear = (c) =>
    c.map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
  const [r, g, b] = linear(channels(getComputedStyle(el).color));
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return (luminance + 0.05) / 0.05;
})()`;

const TIMELINE_REACHABLE = `(() => {
  const timeline = document.querySelector(".editor-timeline");
  if (!timeline) return false;
  const column = timeline.closest(".editor-center");
  if (column) column.scrollTop = column.scrollHeight;
  return timeline.getBoundingClientRect().bottom <= window.innerHeight + 1;
})()`;

const OVERFLOW = `(() => {
  const limitX = window.innerWidth, limitY = window.innerHeight;
  const space = document.querySelector(".editor-workspace");
  if (!space) return { missing: true };
  const outside = [...space.querySelectorAll("button, input, select")]
    .filter((el) => el.offsetParent !== null)
    .filter((el) => { const r = el.getBoundingClientRect(); return r.right > limitX + 1 || r.bottom > limitY + 1; })
    .map((el) => (el.getAttribute("aria-label") || el.textContent.trim() || el.tagName).slice(0, 40));
  return { horizontalScroll: document.documentElement.scrollWidth > window.innerWidth, outside };
})()`;

async function main() {
  const report = createReport(SCENARIO);
  const session = await startSession(SCENARIO, { language: LANG });
  const { page } = session;
  try {
    await report.step("abrir el espacio Editor", () => openEditorSpace(page, L));

    await report.step("nombres accesibles en los controles del Editor", async () => {
      const audit = await page.evaluate(AUDIT);
      report.metric("botones del Editor", audit.buttons);
      report.metric("campos del Editor", audit.fields);
      report.check(
        "todos los botones tienen nombre accesible",
        audit.unnamedButtons.length === 0,
        audit.unnamedButtons.join(" | ") || "ok",
      );
      report.check(
        "todos los campos tienen etiqueta",
        audit.unlabelledFields.length === 0,
        audit.unlabelledFields.join(" | ") || "ok",
      );
    });

    await report.step("orden de foco con Tab y foco visible", async () => {
      await page.evaluate(
        `document.querySelector(".editor-toolbar")?.querySelector("button")?.focus()`,
      );
      const walk = [];
      for (let step = 1; step <= 25; step += 1) {
        await page.cdp.send("Input.dispatchKeyEvent", {
          type: "keyDown",
          key: "Tab",
          code: "Tab",
          windowsVirtualKeyCode: 9,
        });
        await page.cdp.send("Input.dispatchKeyEvent", {
          type: "keyUp",
          key: "Tab",
          code: "Tab",
          windowsVirtualKeyCode: 9,
        });
        walk.push(await page.evaluate(TAB_WALK(step)));
      }
      const withoutFocusRing = walk.filter((entry) => !entry.visible && entry.element !== "body");
      report.metric("elementos recorridos con Tab", walk.length);
      report.check(
        "cada elemento enfocado muestra un contorno visible",
        withoutFocusRing.length === 0,
        withoutFocusRing.map((e) => e.element).join(" | ") || "ok",
      );
      report.check(
        "el foco avanza por los controles (no se queda en el cuerpo)",
        walk.filter((e) => e.element === "body").length < 5,
        `pasos en body=${walk.filter((e) => e.element === "body").length}`,
      );
    });

    const matrix = [
      [1366, 768, 1],
      [1366, 768, 1.25],
      [1366, 768, 1.5],
      [1920, 1080, 1.25],
      [1920, 1080, 1.5],
    ];
    for (const [physicalW, physicalH, scale] of matrix) {
      const cssW = Math.round(physicalW / scale);
      const cssH = Math.round(physicalH / scale);
      const label = `${physicalW}×${physicalH} a ${Math.round(scale * 100)} % (CSS ${cssW}×${cssH})`;
      await report.step(`diseño ${label}`, async () => {
        await page.viewport({ width: cssW, height: cssH, scale });
        await page.evaluate(
          `new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`,
        );
        const overflow = await page.evaluate(OVERFLOW);
        report.check(`sin desbordamiento horizontal: ${label}`, !overflow.horizontalScroll);
        report.check(
          `todos los controles caben en pantalla: ${label}`,
          overflow.outside.length === 0,
          overflow.outside.join(" | ") || "ok",
        );
        report.check(
          `la línea de tiempo se alcanza: ${label}`,
          await page.evaluate(TIMELINE_REACHABLE),
        );
        const file = path.join(
          RUN_ROOT,
          SCENARIO,
          `${LANG}-${physicalW}x${physicalH}-${Math.round(scale * 100)}.png`,
        );
        await page.screenshot(file);
        report.metric(`captura ${physicalW}×${physicalH} a ${Math.round(scale * 100)} %`, file);
      });
    }

    for (const expected of ["dark", "light"]) {
      await report.step(`tema ${expected} a 911×512 CSS (1366×768 al 150 %)`, async () => {
        const current = await page.evaluate(
          `document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark"`,
        );
        if (current !== expected) {
          const clicked = await page.evaluate(`(() => {
            const toggle = [...document.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") ?? "").startsWith(${JSON.stringify(themePrefix)}));
            toggle?.click();
            return Boolean(toggle);
          })()`);
          report.check(`el interruptor de tema existe para ${expected}`, clicked);
          await waitUntil(
            () =>
              page.evaluate(
                `(document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark") === ${JSON.stringify(expected)}`,
              ),
            { timeout: 10000, label: `theme ${expected}` },
          );
        }
        await page.viewport({ width: 911, height: 512, scale: 1.5 });
        await page.evaluate(
          `new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`,
        );
        const overflow = await page.evaluate(OVERFLOW);
        report.check(`sin desbordamiento en tema ${expected}`, !overflow.horizontalScroll);
        report.check(
          `controles visibles en tema ${expected}`,
          overflow.outside.length === 0,
          overflow.outside.join(" | ") || "ok",
        );
        const contrast = await page.evaluate(STAGE_HINT_CONTRAST);
        report.check(
          `contraste del aviso de la vista previa en tema ${expected} (4,5:1 o más)`,
          contrast !== null && contrast >= 4.5,
          contrast === null ? "sin aviso" : `${contrast.toFixed(2)}:1`,
        );
        await page.screenshot(path.join(RUN_ROOT, SCENARIO, `${LANG}-tema-${expected}.png`));
      });
    }
    await page.viewport({ width: 1366, height: 768, scale: 1 });
  } finally {
    await session.stop();
  }
  const summary = report.finish();
  if (summary.failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
