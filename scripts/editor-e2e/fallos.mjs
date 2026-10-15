import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { sleep, translations, waitUntil, killTree } from "./harness.mjs";
import { basicFixtures, longFixture } from "./fixtures.mjs";
import { openEditorSpace, startSession } from "./session.mjs";
import { createReport } from "./report.mjs";

const SCENARIO = process.env.BERU_E2E_APP ? "fallos-app-empaquetada" : "fallos";
const es = translations("es");
const L = {
  railLabel: es["editor.railLabel"],
  import: es["editor.import"],
  useClip: es["editor.useClip"],
  export: es["editor.export"],
  exportCancel: es["editor.exportCancel"],
};

function exportPids(outputName) {
  const script = [
    "Get-CimInstance Win32_Process | Where-Object {",
    "  $_.Name -eq 'beru-processor.exe' -or ($_.Name -eq 'ffmpeg.exe' -and $_.CommandLine -like '*" +
      outputName +
      "*')",
    "} | ForEach-Object { $_.ProcessId }; exit 0",
  ].join(" ");
  const out = execFileSync("powershell", ["-NoProfile", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
  });
  return out.split(/\s+/).filter(Boolean).map(Number);
}

function describePids(pids) {
  if (pids.length === 0) return "";
  const list = pids.join(",");
  const script = `Get-CimInstance Win32_Process -Filter "ProcessId IN (${list})" | ForEach-Object { $_.ProcessId.ToString() + " " + $_.Name + " " + $_.CreationDate + " " + ($_.CommandLine.Substring(0, [Math]::Min(160, $_.CommandLine.Length))) }; exit 0`;
  return execFileSync("powershell", ["-NoProfile", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
  }).trim();
}

function lockFile(file) {
  fs.writeFileSync(file, "contenido original");
  const script = `$f=[System.IO.File]::Open('${file}','Open','Read','Read'); Start-Sleep -Seconds 300`;
  return spawn("powershell", ["-NoProfile", "-Command", script], {
    windowsHide: true,
    stdio: "ignore",
  });
}

const clipCount = (page) => page.evaluate(`document.querySelectorAll(".timeline-clip").length`);

async function main() {
  const report = createReport(SCENARIO);
  const dir = report.dir;
  const fixtures = basicFixtures();
  const media = path.join(dir, "media");
  fs.mkdirSync(media, { recursive: true });
  const corrupt = path.join(media, "corrupto.mp4");
  fs.copyFileSync(fixtures.corrupt, corrupt);
  const long = path.join(media, "largo-60s.mp4");
  fs.copyFileSync(longFixture(), long);

  const cancelled = path.join(dir, "cancelado.mp4");
  const locked = path.join(dir, "bloqueado.mp4");
  const exported = path.join(dir, "trimmed.mp4");
  for (const file of [cancelled, `${cancelled}.partial`, locked, `${locked}.partial`, exported]) {
    fs.rmSync(file, { force: true });
  }

  const session = await startSession(SCENARIO);
  const { page, main: host } = session;
  let lock = null;
  try {
    await report.step("abrir el espacio Editor", () => openEditorSpace(page, L));

    await report.step("un archivo ilegible no entra al proyecto y se informa", async () => {
      await host.queueOpen([corrupt]);
      await page.click(L.import);
      await page.waitForText("1 archivo(s) no se pudieron importar.", { timeout: 60000 });
      const library = await page.text(".editor-library");
      report.check(
        "el archivo ilegible no aparece en la biblioteca",
        !library.includes("corrupto.mp4"),
      );
    });

    await report.step("montar el video de 60 s", async () => {
      await host.queueOpen([long]);
      await page.click(L.import);
      await page.waitForText("largo-60s.mp4", { selector: ".editor-library", timeout: 60000 });
      await waitUntil(async () => (await clipCount(page)) === 1, { label: "auto-appended clip" });
      await page.waitForText("1:00.00", { selector: ".editor-timeline-head", timeout: 10000 });
      report.check("el montaje tiene 60 s", true);
    });

    await report.step("cancelar una exportación en curso", async () => {
      const before = exportPids("cancelado.mp4");
      await host.queueSave(cancelled);
      await page.click(L.export);
      await waitUntil(
        () =>
          page.evaluate(
            `Boolean(document.querySelector("progress")) && Number(document.querySelector("progress").value) > 3`,
          ),
        { timeout: 240000, label: "export progress" },
      );
      report.check("la exportación avanza antes de cancelarla", true);
      await page.click(L.exportCancel);
      await page.waitForButton(L.export, { timeout: 120000 });
      await waitUntil(
        async () => exportPids("cancelado.mp4").filter((pid) => !before.includes(pid)).length === 0,
        { timeout: 60000, label: "processes to exit" },
      ).catch(() => {});
      const after = exportPids("cancelado.mp4").filter((pid) => !before.includes(pid));
      report.check(
        "no queda ningún MP4 ni .partial tras cancelar",
        !fs.existsSync(cancelled) && !fs.existsSync(`${cancelled}.partial`),
      );
      report.check(
        "el procesador y FFmpeg terminaron tras cancelar",
        after.length === 0,
        after.length ? describePids(after) : "ninguno",
      );
      report.check(
        "no quedan archivos de grafo junto a la salida",
        !fs
          .readdirSync(dir)
          .some((name) => name.startsWith("cancelado.mp4") && name !== "cancelado.mp4"),
      );
    });

    await report.step("destino ocupado por otro programa", async () => {
      lock = lockFile(locked);
      await sleep(3000);
      await page.mouseClick(".timeline-clip");
      await page.setInput(".editor-range label:nth-child(2) input", "3");
      await page.waitForText("0:03.00", { selector: ".editor-timeline-head", timeout: 10000 });
      await host.queueSave(locked);
      await page.click(L.export);
      await page.waitForButton(L.export, { timeout: 240000 });
      await sleep(1000);
      const content = fs.readFileSync(locked, "utf8");
      report.check(
        "el archivo bloqueado no cambia",
        content === "contenido original",
        `contenido=${JSON.stringify(content.slice(0, 40))}`,
      );
      report.check("no queda .partial del destino bloqueado", !fs.existsSync(`${locked}.partial`));
      const toast = await page.text(".app-toast-layer");
      report.check(
        "la falla se informa al usuario",
        Boolean(toast && toast.trim()),
        toast ?? "sin aviso",
      );
    });

    lock?.kill();
    await killTree(lock);
    lock = null;
    await sleep(500);

    await report.step("cerrar la app durante una exportación", async () => {
      await page.click(L.exportCancel).catch(() => {});
      await page.waitForButton(L.export, { timeout: 60000 }).catch(() => {});
      await page.evaluate(`(() => {
        const range = document.querySelector(".editor-range label:nth-child(2) input");
        return Boolean(range);
      })()`);
      await page.setInput(".editor-range label:nth-child(2) input", "60");
      await page.waitForText("1:00.00", { selector: ".editor-timeline-head", timeout: 10000 });
      const before = exportPids("trimmed.mp4");
      await host.queueSave(exported);
      await page.click(L.export);
      await waitUntil(
        () =>
          page.evaluate(
            `Boolean(document.querySelector("progress")) && Number(document.querySelector("progress").value) > 3`,
          ),
        { timeout: 240000, label: "export progress before quit" },
      );
      await host.quit();
      await waitUntil(
        async () => exportPids("trimmed.mp4").filter((pid) => !before.includes(pid)).length === 0,
        { timeout: 60000, label: "processor exit after quit" },
      );
      report.check("el procesador termina al cerrar la app", true);
      report.check(
        "no queda MP4 parcial tras cerrar la app",
        !fs.existsSync(`${exported}.partial`) && !fs.existsSync(exported),
      );
    });
  } finally {
    lock?.kill();
    await session.stop();
  }
  const summary = report.finish();
  if (summary.failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
