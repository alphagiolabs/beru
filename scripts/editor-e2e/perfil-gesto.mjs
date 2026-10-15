import fs from "node:fs";
import path from "node:path";
import { RUN_ROOT, sleep, translations, waitUntil } from "./harness.mjs";
import { openEditorSpace, startSession } from "./session.mjs";

const es = translations("es");
const L = {
  railLabel: es["editor.railLabel"],
  import: es["editor.import"],
  open: es["editor.open"],
};
const project = path.join(RUN_ROOT, "latencias", "gesto.beru-edit.json");
const IDLE = new Set(["(idle)", "(program)", "(garbage collector)", "(root)"]);

function selfTimes(profile) {
  const frames = new Map(profile.nodes.map((node) => [node.id, node.callFrame]));
  const totals = new Map();
  profile.samples.forEach((id, index) => {
    const frame = frames.get(id);
    const name = frame.functionName || "(anónima)";
    const where = `${path.basename(frame.url || "(nativo)")}:${frame.lineNumber + 1}`;
    const key = `${name}  ${where}`;
    totals.set(key, (totals.get(key) ?? 0) + (profile.timeDeltas[index] ?? 0) / 1000);
  });
  return [...totals].sort((a, b) => b[1] - a[1]);
}

async function main() {
  if (!fs.existsSync(project))
    throw new Error("Falta el proyecto de latencias.mjs: ejecútalo primero");
  const session = await startSession("perfil-gesto");
  const { page, main: host } = session;
  try {
    await openEditorSpace(page, L);
    await host.queueOpen([project]);
    await page.click(L.open);
    await waitUntil(
      () => page.evaluate(`document.querySelectorAll(".timeline-clip").length === 3`),
      { timeout: 60000, label: "gesture clips" },
    );
    await sleep(1000);

    await page.cdp.send("Profiler.enable");
    await page.cdp.send("Profiler.setSamplingInterval", { interval: 100 });
    await page.cdp.send("Profiler.start");
    for (let press = 0; press < 4; press += 1) {
      await page.mouseClick(".timeline-clip");
      await sleep(300);
    }
    await page.mouseDrag(".timeline-clip .timeline-handle--end", -30, 0, {
      steps: 10,
      pauseMs: 60,
    });
    await sleep(300);
    const { profile } = await page.cdp.send("Profiler.stop");

    const ranked = selfTimes(profile);
    const busy = ranked.filter(([key]) => ![...IDLE].some((name) => key.startsWith(name)));
    const lines = busy.slice(0, 40).map(([key, ms]) => `${ms.toFixed(1).padStart(8)} ms  ${key}`);
    const out = path.join(RUN_ROOT, "perfil-gesto.txt");
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, lines.join("\n") + "\n");
    console.log(lines.join("\n"));
    console.log(`\nperfil guardado en ${out}`);
  } finally {
    await session.stop();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
