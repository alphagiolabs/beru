import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { FFPROBE, RUN_ROOT, translations, waitUntil } from "./harness.mjs";
import { codecFixtures } from "./fixtures.mjs";
import { openEditorSpace, startSession } from "./session.mjs";
import { createReport } from "./report.mjs";

const SCENARIO = process.env.BERU_E2E_APP ? "codecs-app-empaquetada" : "codecs";
const es = translations("es");
const loadingText = es["editor.loading"];
const L = {
  railLabel: es["editor.railLabel"],
  import: es["editor.import"],
  export: es["editor.export"],
  proxy: es["editor.proxy.create"],
};

const PREVIEW_STATE = `(() => {
  const videos = [...document.querySelectorAll(".editor-video")];
  const playable = videos.some((v) => v.readyState >= 2 && v.videoWidth > 0);
  const message = document.querySelector(".editor-stage-message span")?.textContent ?? null;
  const proxy = [...document.querySelectorAll(".editor-stage-message button")].some((b) => b.textContent.trim() !== "");
  return { playable, message, proxy };
})()`;

const IMPORT_STATE = (name) => `(() => {
  const lib = document.querySelector(".editor-library")?.innerText ?? "";
  if (lib.includes(${JSON.stringify(name)})) return "ok";
  const toast = document.querySelector(".app-toast-layer")?.textContent ?? "";
  if (toast.includes("no se pudieron importar")) return "failed";
  return null;
})()`;

function probeOutput(file) {
  const out = execFileSync(
    FFPROBE,
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration:stream=codec_type,codec_name",
      "-of",
      "json",
      file,
    ],
    { encoding: "utf8", windowsHide: true },
  );
  const info = JSON.parse(out);
  const video = info.streams.find((s) => s.codec_type === "video");
  return { durationS: Number(info.format.duration), videoCodec: video?.codec_name ?? null };
}

async function runOne(fixture, dir) {
  const result = {
    name: fixture.name,
    imported: false,
    mode: "sin resultado",
    message: null,
    proxyMs: null,
    proxyError: null,
    exported: false,
    exportNote: null,
    output: null,
  };
  const sessionName = `codecs-${fixture.name.replace(/\./g, "-")}`;
  const session = await startSession(sessionName);
  const { page, main: host } = session;
  try {
    await openEditorSpace(page, L);
    await host.queueOpen([fixture.file]);
    await page.click(L.import);
    const imported = await waitUntil(() => page.evaluate(IMPORT_STATE(fixture.name)), {
      timeout: 60000,
      interval: 300,
      label: "import result",
    });
    result.imported = imported === "ok";
    if (!result.imported) {
      result.exportNote = "no se importó";
      return result;
    }
    const first = await waitUntil(
      async () => {
        const state = await page.evaluate(PREVIEW_STATE);
        if (state.playable) return state;
        return state.message && !state.message.includes(loadingText) ? state : null;
      },
      { timeout: 60000, interval: 500, label: "preview state" },
    );
    if (first.playable) {
      result.mode = "nativa";
    } else {
      result.message = first.message;
      if (first.proxy) {
        const started = Date.now();
        await page.click(L.proxy);
        const after = await waitUntil(
          async () => {
            const state = await page.evaluate(PREVIEW_STATE);
            if (state.playable) return { ok: true };
            const toast = await page.text(".app-toast-layer");
            if (toast && toast.trim()) return { ok: false, error: toast.trim() };
            return null;
          },
          { timeout: 240000, interval: 1000, label: "proxy result" },
        );
        result.proxyMs = Date.now() - started;
        if (after.ok) result.mode = "proxy";
        else {
          result.mode = "error claro";
          result.proxyError = after.error;
        }
      } else {
        result.mode = "error claro";
      }
    }
    const output = path.join(dir, `${fixture.name}-montaje.mp4`);
    fs.rmSync(output, { force: true });
    await host.queueSave(output);
    await page.click(L.export);
    await page.waitForButtonGone(L.export, { timeout: 20000 }).catch(() => {});
    await page.waitForButton(L.export, { timeout: 300000 });
    const toast = (await page.text(".app-toast-layer")) ?? "";
    if (fs.existsSync(output)) {
      const info = probeOutput(output);
      result.output = info;
      result.exported = Math.abs(info.durationS - 3) < 0.25;
      result.exportNote = `${info.videoCodec}, ${info.durationS.toFixed(2)} s`;
    } else {
      result.exportNote = toast.trim() || "sin archivo";
    }
    return result;
  } catch (error) {
    result.exportNote = result.exportNote ?? error.message;
    return result;
  } finally {
    await session.stop();
  }
}

async function main() {
  const report = createReport(SCENARIO);
  const dir = path.join(RUN_ROOT, SCENARIO);
  fs.mkdirSync(dir, { recursive: true });
  const rows = [];
  for (const fixture of codecFixtures()) {
    const r = await runOne(fixture, dir);
    rows.push(r);
    const previewOk = ["nativa", "proxy", "error claro"].includes(r.mode);
    report.check(`${r.name}: se importa`, r.imported, r.imported ? "" : (r.exportNote ?? ""));
    report.check(
      `${r.name}: vista previa nativa, proxy o aviso claro`,
      previewOk,
      r.mode +
        (r.message ? ` — ${r.message}` : "") +
        (r.proxyError ? ` — proxy: ${r.proxyError}` : ""),
    );
    if (r.proxyMs) report.metric(`${r.name}: proxy`, r.proxyMs, "ms");
    report.check(`${r.name}: exporta con 3 s`, r.exported, r.exportNote ?? "");
  }
  fs.writeFileSync(path.join(dir, "tabla.json"), JSON.stringify(rows, null, 2));
  const summary = report.finish();
  if (summary.failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
