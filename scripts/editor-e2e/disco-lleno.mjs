import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { RUN_ROOT, translations, waitUntil } from "./harness.mjs";
import { basicFixtures } from "./fixtures.mjs";
import { openEditorSpace, startSession } from "./session.mjs";
import { createReport } from "./report.mjs";

const SCENARIO = "disco-lleno";
const VOLUME_MB = 64;
const es = translations("es");
const L = {
  railLabel: es["editor.railLabel"],
  import: es["editor.import"],
  export: es["editor.export"],
};

const dir = path.join(RUN_ROOT, SCENARIO);
const vhdx = path.join(dir, "test.vhdx");
const mount = path.join(dir, "mount");

function diskpart(lines) {
  const script = path.join(dir, "diskpart.txt");
  fs.writeFileSync(script, lines.join("\r\n") + "\r\n");
  return execFileSync("diskpart", ["/s", script], { encoding: "utf8", windowsHide: true });
}

function freeBytes(folder) {
  const stats = fs.statfsSync(folder);
  return stats.bavail * stats.bsize;
}

function fillVolume(folder, leaveBytes) {
  const file = path.join(folder, "relleno.bin");
  const chunk = Buffer.alloc(1024 * 1024);
  const fd = fs.openSync(file, "w");
  try {
    let remaining = freeBytes(folder) - leaveBytes;
    while (remaining > 0) {
      const size = Math.min(chunk.length, remaining);
      fs.writeSync(fd, chunk, 0, size);
      remaining -= size;
    }
  } finally {
    fs.closeSync(fd);
  }
  return file;
}

function createVolume() {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(mount, { recursive: true });
  diskpart([
    `create vdisk file="${vhdx}" maximum=${VOLUME_MB} type=expandable`,
    `select vdisk file="${vhdx}"`,
    "attach vdisk",
    "create partition primary",
    "format fs=ntfs label=BERUTEST quick",
    `assign mount="${mount}"`,
  ]);
}

function removeVolume() {
  try {
    diskpart([`select vdisk file="${vhdx}"`, "detach vdisk"]);
  } catch (error) {
    console.error("Could not detach the test volume:", error.message);
  }
  fs.rmSync(vhdx, { force: true });
}

async function main() {
  const report = createReport(SCENARIO);
  let started = null;
  try {
    createVolume();
    const total = freeBytes(mount);
    report.check(
      "el volumen de prueba está montado y es pequeño",
      total > 0 && total < 80 * 1024 * 1024,
      `${Math.round(total / 1024 / 1024)} MB libres`,
    );
    const filler = fillVolume(mount, 96 * 1024);
    const left = freeBytes(mount);
    report.check("el volumen queda casi lleno", left < 128 * 1024, `${left} bytes libres`);
    report.metric("bytes libres antes de exportar", left, "B");

    const media = path.join(dir, "media");
    fs.mkdirSync(media, { recursive: true });
    const source = path.join(media, "a.mp4");
    fs.copyFileSync(basicFixtures().a, source);
    const output = path.join(mount, "montaje.mp4");

    started = await startSession(SCENARIO);
    const { page, main: host } = started;
    await report.step("importar un video y exportar a un volumen sin espacio", async () => {
      await openEditorSpace(page, L);
      await host.queueOpen([source]);
      await page.click(L.import);
      await page.waitForText("a.mp4", { selector: ".editor-library", timeout: 60000 });
      await host.queueSave(output);
      await page.click(L.export);
      await page.waitForButton(L.export, { timeout: 300000 });
      await waitUntil(
        () =>
          page.evaluate(
            `(document.querySelector(".app-toast-layer")?.textContent ?? "").length > 0`,
          ),
        { timeout: 30000, label: "error notice" },
      );
      const toast = await page.text(".app-toast-layer");
      report.check(
        "el aviso dice que no hay espacio en el disco",
        toast.includes("espacio suficiente"),
        toast.trim(),
      );
      report.check("no queda el MP4 de salida", !fs.existsSync(output));
      report.check("no queda el .partial de salida", !fs.existsSync(`${output}.partial`));
    });
    fs.rmSync(filler, { force: true });
  } finally {
    if (started) await started.stop();
    removeVolume();
    report.check("el volumen de prueba se desmontó y eliminó", !fs.existsSync(vhdx));
  }
  const summary = report.finish();
  if (summary.failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
  try {
    removeVolume();
  } catch (cleanupError) {
    console.error("Could not remove the test volume:", cleanupError.message);
  }
});
