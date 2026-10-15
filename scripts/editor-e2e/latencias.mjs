import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { FFMPEG, buildRendererProd, probe, sleep, translations, waitUntil } from "./harness.mjs";
import { openEditorSpace, startSession } from "./session.mjs";
import { createReport } from "./report.mjs";
import { addAsset, insertClip, setCanvas } from "../../shared/editor-timeline.js";
import { createEmptyEditorProject } from "../../shared/editor-project.js";

const SCENARIO = "latencias";
const SECOND = 1_000_000;
const es = translations("es");
const L = {
  railLabel: es["editor.railLabel"],
  import: es["editor.import"],
  open: es["editor.open"],
  play: es["editor.play"],
  pause: es["editor.pause"],
  zoomIn: es["editor.timeline.zoomIn"],
  proxyCreate: es["editor.proxy.create"],
  exactFrame: es["editor.exactFrame"],
};

const percentile = (values, p) => {
  const sorted = [...values].sort((x, y) => x - y);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
};

function summarize(values) {
  if (values.length === 0) return null;
  return {
    n: values.length,
    p50: percentile(values, 50),
    p90: percentile(values, 90),
    max: Math.max(...values),
  };
}

function writeProject(file, { source, clips, canvas = { width: 1280, height: 720 } }) {
  let project = setCanvas(createEmptyEditorProject({ name: path.basename(file) }), canvas);
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
  project = added.project;
  for (const [inUs, outUs] of clips) {
    project = insertClip(project, {
      assetId: added.assetId,
      sourceInUs: inUs,
      sourceOutUs: outUs,
    }).project;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(project, null, 2));
  return file;
}

const RECORD_GESTURE = `(() => {
  const track = document.querySelector(".timeline-clip")?.parentElement;
  const snapshot = () => [...document.querySelectorAll(".timeline-clip")].map((el) => el.getAttribute("style") ?? "").join("|");
  window.__snapshot = snapshot;
  window.__gesture = { moves: [], snaps: [], changes: [], discrete: [] };
  document.addEventListener("pointermove", (event) => {
    window.__gesture.moves.push(event.timeStamp);
    window.__gesture.snaps.push(snapshot());
  }, true);
  new MutationObserver(() => { window.__gesture.changes.push(performance.now()); }).observe(track, {
    subtree: true, attributes: true, attributeFilter: ["style"],
  });
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) window.__gesture.discrete.push({ name: entry.name, duration: entry.duration });
  }).observe({ type: "event", durationThreshold: 16 });
  return true;
})()`;

const RESET_GESTURE = `(() => {
  window.__gesture.moves = [];
  window.__gesture.snaps = [];
  window.__gesture.changes = [];
  window.__gesture.discrete = [];
  return true;
})()`;

const CONTROL_BLOCK = (type) => `(() => {
  window.__block = () => { const end = performance.now() + 80; while (performance.now() < end) {  } };
  document.addEventListener(${JSON.stringify(type)}, window.__block, true);
  return true;
})()`;
const CONTROL_UNBLOCK = (type) => `(() => {
  document.removeEventListener(${JSON.stringify(type)}, window.__block, true);
  return true;
})()`;

function responses(record, finalSnapshot) {
  const samples = [];
  let unchanged = 0;
  let unmeasured = 0;
  record.moves.forEach((moved, i) => {
    const before = record.snaps[i];
    const after = i + 1 < record.snaps.length ? record.snaps[i + 1] : finalSnapshot;
    if (before === after) {
      unchanged += 1;
      return;
    }
    const change = record.changes.find((time) => time >= moved);
    if (change === undefined) unmeasured += 1;
    else samples.push(change - moved);
  });
  return { samples, unchanged, unmeasured, moves: record.moves.length };
}

function firstResponse(moves, changes) {
  if (moves.length === 0) return null;
  const change = changes.find((time) => time >= moves[0]);
  return change === undefined ? null : change - moves[0];
}

const SCRUB_LIMIT_MS = 150;

const SCRUB = (target) => `new Promise((resolve) => {
  const slider = document.querySelector('.editor-transport input[type="range"]');
  const shown = () => document.querySelector(".editor-clip-frame.is-active .editor-video");
  const onProxy = () => (shown()?.src ?? "").includes("editor-proxies");
  const videos = [...document.querySelectorAll(".editor-video")];
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  const started = performance.now();
  const proxiedBefore = onProxy();
  let settled = false;
  const finish = (value) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    videos.forEach((video) => video.removeEventListener("seeked", onSeeked));
    resolve(value);
  };
  const onSeeked = () => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const proxiedAfter = onProxy();
      finish({
        ms: performance.now() - started,
        proxied: proxiedBefore,
        switched: proxiedAfter !== proxiedBefore,
        at: performance.now(),
      });
    }));
  };
  const timer = setTimeout(() => finish(null), 3000);
  videos.forEach((video) => video.addEventListener("seeked", onSeeked));
  setter.call(slider, ${JSON.stringify(String(target))});
  slider.dispatchEvent(new Event("input", { bubbles: true }));
})`;

const WATCH_PROXY = `(() => {
  window.__proxySwitches = [];
  new MutationObserver((records) => {
    for (const record of records) {
      const src = record.target.getAttribute("src") ?? "";
      if (record.target.matches(".editor-video") && src.includes("editor-proxies")) window.__proxySwitches.push(performance.now());
    }
  }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["src"] });
  return true;
})()`;

const PROXY_READY = `(() => {
  const video = document.querySelector(".editor-clip-frame.is-active .editor-video");
  return Boolean(video && video.src.includes("editor-proxies") && video.readyState >= 2 && !video.seeking);
})()`;

const EXACT_FRAME = `(async () => {
  const started = performance.now();
  [...document.querySelectorAll(".editor-transport button")].find((b) => b.textContent.trim() === ${JSON.stringify(es["editor.exactFrame"])}).click();
  while (performance.now() - started < 10000) {
    const img = document.querySelector(".editor-exact-frame img");
    if (img?.complete && img.naturalWidth > 0) break;
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
  const elapsed = performance.now() - started;
  document.querySelector(".editor-exact-frame > .editor-button")?.click();
  await new Promise((resolve) => setTimeout(resolve, 100));
  return elapsed;
})()`;

const PRESENTED_FRAMES = (seconds) => `new Promise((resolve) => {
  let frames = 0;
  let counting = false;
  let running = true;
  const videos = [...document.querySelectorAll(".editor-video")];
  const attach = (video) => {
    const next = () => {
      if (!running) return;
      if (counting) frames += 1;
      video.requestVideoFrameCallback(next);
    };
    video.requestVideoFrameCallback(next);
  };
  videos.forEach(attach);
  setTimeout(() => {
    counting = true;
    const started = performance.now();
    setTimeout(() => {
      running = false;
      resolve({ frames, seconds: (performance.now() - started) / 1000 });
    }, ${seconds * 1000});
  }, 1000);
})`;

function seekTargets(length, count = 20) {
  const targets = [];
  let seed = 7;
  for (let i = 0; i < count; i += 1) {
    seed = (seed * 16807) % 2147483647;
    targets.push(((seed % 1000) / 1000) * (length - 0.5));
  }
  return targets;
}

async function main() {
  const report = createReport(SCENARIO);
  const dir = report.dir;
  const source = path.join(dir, "fuente-720.mp4");
  const hd = path.join(dir, "fuente-1080-gop.mp4");
  const avi = path.join(dir, "fuente-avi-mpeg4.avi");
  const projectGesture = path.join(dir, "gesto.beru-edit.json");
  const projectHd = path.join(dir, "reproduccion-1080.beru-edit.json");
  const projectMany = path.join(dir, "filmstrip-30.beru-edit.json");
  const projectAvi = path.join(dir, "proxy-avi.beru-edit.json");

  if (!fs.existsSync(source)) {
    execFileSync(FFMPEG, [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=1280x720:rate=30:duration=20",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=20",
      "-map",
      "0:v",
      "-map",
      "1:a",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      source,
    ]);
  }
  if (!fs.existsSync(hd)) {
    execFileSync(FFMPEG, [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=1920x1080:rate=30:duration=12",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=330:duration=12",
      "-map",
      "0:v",
      "-map",
      "1:a",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-g",
      "360",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      hd,
    ]);
  }
  if (!fs.existsSync(avi)) {
    execFileSync(FFMPEG, [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=1280x720:rate=30:duration=20",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=20",
      "-map",
      "0:v",
      "-map",
      "1:a",
      "-c:v",
      "mpeg4",
      "-q:v",
      "4",
      "-c:a",
      "libmp3lame",
      "-b:a",
      "128k",
      avi,
    ]);
  }
  writeProject(projectGesture, {
    source,
    clips: [
      [0, 5 * SECOND],
      [5 * SECOND, 10 * SECOND],
      [10 * SECOND, 15 * SECOND],
    ],
  });
  writeProject(projectHd, {
    source: hd,
    clips: [[0, 10 * SECOND]],
    canvas: { width: 1920, height: 1080 },
  });
  writeProject(projectMany, {
    source,
    clips: Array.from({ length: 30 }, (_, i) => [i * 0.5 * SECOND, i * 0.5 * SECOND + SECOND / 2]),
  });
  writeProject(projectAvi, { source: avi, clips: [[0, 15 * SECOND]] });

  const clickBy = (selector) =>
    page.evaluate(`document.querySelector(${JSON.stringify(selector)})?.click() ?? false`);

  const started = Date.now();
  buildRendererProd();
  process.env.BERU_E2E_RENDERER = "prod";
  let session = null;
  let page = null;
  let host = null;
  const openSession = async (name) => {
    if (session) await session.stop();
    session = page = host = null;
    session = await startSession(name);
    ({ page, main: host } = session);
    await openEditorSpace(page, L);
    await page.evaluate(WATCH_PROXY);
  };
  const switchCount = () => page.evaluate("window.__proxySwitches?.length ?? 0");
  const scrubPass = async (length) => {
    const seeks = [];
    for (const target of seekTargets(length)) {
      seeks.push(await page.evaluate(SCRUB(target.toFixed(2))));
      await sleep(120);
    }
    return seeks;
  };
  const waitFilmstripSettled = async () => {
    let last = -1;
    let stableSince = Date.now();
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      const count = await page.evaluate(
        `document.querySelectorAll(".timeline-clip-frames img").length`,
      );
      const empty = await page.evaluate(
        `document.querySelectorAll(".timeline-clip-frame-empty").length`,
      );
      if (count !== last) {
        last = count;
        stableSince = Date.now();
      } else if (empty === 0 && Date.now() - stableSince >= 1000) {
        return;
      }
      await sleep(100);
    }
    throw new Error("the filmstrip did not settle within 60 s");
  };
  const reportSeeks = (label, seeks, proxied) => {
    const times = seeks
      .filter((seek) => seek !== null && !seek.switched && seek.proxied === proxied)
      .map((seek) => seek.ms);
    report.metric(
      `búsquedas en orden (${label})`,
      times.map((ms) => ms.toFixed(0)).join(" / "),
      "ms",
    );
    const stats = summarize(times);
    const straddled = seeks.filter((seek) => seek !== null && seek.switched).length;
    const answered = seeks.filter((seek) => seek !== null).length;
    report.metric(
      `búsqueda hasta el fotograma (p50, ${label})`,
      stats ? stats.p50.toFixed(1) : "sin muestras",
      stats ? "ms" : "",
    );
    report.metric(
      `búsqueda hasta el fotograma (p90, ${label})`,
      stats ? stats.p90.toFixed(1) : "sin muestras",
      stats ? "ms" : "",
    );
    report.metric(`búsquedas que cruzaron el cambio a proxy (${label})`, straddled, "");
    report.check(
      `la búsqueda completa en todas las posiciones (${label})`,
      answered === 20,
      `${answered}/20`,
    );
    return stats;
  };
  const passUntilProxy = async (label) => {
    const before = await switchCount();
    const passStart = await page.evaluate("performance.now()");
    const seeks = await scrubPass(15);
    reportSeeks(label, seeks, false);
    const switchedAt = await waitUntil(
      () =>
        page.evaluate(
          `window.__proxySwitches.length > ${before} ? window.__proxySwitches[${before}] : null`,
        ),
      { timeout: 240000, label: `proxy switch (${label})` },
    ).catch(() => null);
    const seconds = switchedAt === null ? null : (switchedAt - passStart) / 1000;
    report.check(
      `el proxy automático entra en la vista previa (${label})`,
      seconds !== null,
      seconds === null ? "no se activó" : `${seconds.toFixed(1)} s desde el inicio de la pasada`,
    );
    if (seconds !== null) {
      report.metric(`proxy automático, desde el inicio de la pasada (${label})`, seconds, "s");
    }
    return { seeks, switchedAt };
  };
  try {
    await report.step("abrir el espacio Editor", () => openSession("latencias-gesto"));

    await report.step("respuesta a un arrastre del recorte", async () => {
      await host.queueOpen([projectGesture]);
      await page.click(L.open);
      await waitUntil(
        () => page.evaluate(`document.querySelectorAll(".timeline-clip").length === 3`),
        { timeout: 60000, label: "gesture clips" },
      );
      await page.evaluate(RECORD_GESTURE);
      const samples = [];
      let moves = 0;
      let unchanged = 0;
      let unmeasured = 0;
      const discrete = [];
      for (let round = 0; round < 3; round += 1) {
        await page.mouseClick(".timeline-clip");
        await page.evaluate(RESET_GESTURE);
        await page.mouseDrag(
          ".timeline-clip .timeline-handle--end",
          round % 2 === 0 ? -24 : 24,
          0,
          { steps: 10, pauseMs: 60 },
        );
        await sleep(400);
        const record = await page.evaluate("window.__gesture");
        const finalSnapshot = await page.evaluate("window.__snapshot()");
        const answered = responses(record, finalSnapshot);
        samples.push(...answered.samples);
        unchanged += answered.unchanged;
        unmeasured += answered.unmeasured;
        moves += answered.moves;
        discrete.push(...record.discrete);
      }
      const stats = summarize(samples);
      report.metric("movimientos del puntero", moves, "");
      report.metric(
        "movimientos que cambian el clip, medidos / sin medir / sin cambio",
        `${samples.length} / ${unmeasured} / ${unchanged}`,
        "",
      );
      if (stats) {
        report.metric("respuesta visible a un movimiento (p50)", stats.p50.toFixed(1), "ms");
        report.metric("respuesta visible a un movimiento (p90)", stats.p90.toFixed(1), "ms");
      }
      report.check(
        "el 90 % de los movimientos con cambio visible responde en ≤ 50 ms",
        stats !== null && stats.p90 <= 50,
        stats
          ? `p90=${stats.p90.toFixed(1)} ms sobre ${stats.n} movimientos`
          : "sin movimientos medidos",
      );

      await page.evaluate(CONTROL_BLOCK("pointermove"));
      await page.mouseClick(".timeline-clip");
      await page.evaluate(RESET_GESTURE);
      await page.mouseDrag(".timeline-clip .timeline-handle--end", -12, 0, { steps: 4 });
      await sleep(400);
      const control = await page.evaluate("window.__gesture");
      await page.evaluate(CONTROL_UNBLOCK("pointermove"));
      const first = firstResponse(control.moves, control.changes);
      report.check(
        "el instrumento mide un movimiento lento de control (80 ms)",
        first !== null && first >= 50,
        first === null
          ? "sin cambio medido"
          : `primer cambio a ${first.toFixed(0)} ms del primer movimiento`,
      );

      const presses = discrete.filter(
        (entry) => entry.name === "pointerdown" || entry.name === "pointerup",
      );
      const slowestPress = Math.max(0, ...presses.map((entry) => entry.duration));
      report.metric("pulsaciones y sueltas de 16 ms o más (Event Timing)", presses.length, "");
      report.metric("la más lenta", slowestPress.toFixed(0), "ms");
      report.check(
        "ninguna pulsación ni suelta tarda más de 50 ms",
        slowestPress <= 50,
        `${slowestPress.toFixed(0)} ms`,
      );
      await page.evaluate(CONTROL_BLOCK("pointerdown"));
      await page.evaluate(RESET_GESTURE);
      await page.mouseClick(".timeline-clip");
      await sleep(400);
      const pressControl = await page.evaluate("window.__gesture.discrete");
      await page.evaluate(CONTROL_UNBLOCK("pointerdown"));
      const blockedPress = Math.max(
        0,
        ...pressControl
          .filter((entry) => entry.name === "pointerdown")
          .map((entry) => entry.duration),
      );
      report.check(
        "Event Timing registra una pulsación lenta de control (80 ms)",
        blockedPress >= 50,
        `${blockedPress.toFixed(0)} ms`,
      );
    });

    await report.step(
      "búsqueda con la fuente nativa y proxy automático (H.264 1280×720, GOP de 250 fotogramas)",
      async () => {
        await openSession("latencias-proxy");
        const openMontage = async () => {
          await host.queueOpen([projectGesture]);
          await page.click(L.open);
          await page.waitForText("0:15.00", { selector: ".editor-timeline-head", timeout: 60000 });
          await waitUntil(
            () =>
              page.evaluate(`(() => {
                const video = document.querySelector(".editor-clip-frame.is-active .editor-video");
                return Boolean(video && !video.src.includes("editor-proxies") && video.readyState >= 2);
              })()`),
            { timeout: 60000, label: "displayed native frame" },
          );
        };
        await openMontage();
        const earlier = await switchCount();
        report.check(
          "antes de la primera pasada no hay cambios a proxy en la vista previa",
          earlier === 0,
          `${earlier} cambios previos`,
        );
        const cold = await passUntilProxy("fuente nativa, antes del proxy");
        report.check(
          `la fuente nativa tiene búsquedas por encima de ${SCRUB_LIMIT_MS} ms (condición del ensayo)`,
          cold.seeks.some(
            (seek) => seek !== null && !seek.switched && !seek.proxied && seek.ms > SCRUB_LIMIT_MS,
          ),
        );
        if (cold.switchedAt === null) return;
        await waitUntil(() => page.evaluate(PROXY_READY), {
          timeout: 60000,
          label: "proxy frame ready",
        });
        await sleep(300);
        const second = await scrubPass(15);
        const proxied = reportSeeks("fuente nativa, con proxy automático", second, true);
        const onProxy = second.filter(
          (seek) => seek !== null && seek.proxied && !seek.switched,
        ).length;
        report.check(
          "todas las búsquedas con proxy usan el proxy",
          onProxy === 20,
          `${onProxy}/20`,
        );
        report.check(
          `con el proxy automático la búsqueda responde en ≤ ${SCRUB_LIMIT_MS} ms (p90)`,
          proxied !== null && proxied.p90 <= SCRUB_LIMIT_MS,
          proxied ? `p90=${proxied.p90.toFixed(1)} ms` : "sin muestras",
        );
        await openMontage();
        await passUntilProxy("fuente nativa, tras reabrir");
      },
    );

    await report.step(
      "búsqueda con proxy de vista previa (MPEG-4 en AVI, que Chromium no reproduce)",
      async () => {
        await openSession("latencias-avi");
        await host.queueOpen([projectAvi]);
        await page.click(L.open);
        await page.waitForButton(L.proxyCreate, { timeout: 60000 });
        await page.click(L.proxyCreate);
        await waitUntil(() => page.evaluate(PROXY_READY), {
          timeout: 240000,
          label: "proxy ready",
        });
        await sleep(300);
        await page.waitForText("0:15.00", { selector: ".editor-timeline-head", timeout: 60000 });
        const stats = reportSeeks("con proxy", await scrubPass(15), true);
        report.check(
          "el p90 de la búsqueda con proxy es ≤ 150 ms",
          stats !== null && stats.p90 <= SCRUB_LIMIT_MS,
          stats ? `p90=${stats.p90.toFixed(1)} ms` : "sin muestras",
        );
        await waitFilmstripSettled();
        reportSeeks("con proxy, tras asentar las miniaturas", await scrubPass(15), true);
      },
    );

    await report.step("vista exacta", async () => {
      const exactFrames = async (name, settle) => {
        await openSession(name);
        await host.queueOpen([projectGesture]);
        await page.click(L.open);
        await page.waitForText("0:15.00", { selector: ".editor-timeline-head", timeout: 60000 });
        if (settle) await waitFilmstripSettled();
        const times = [];
        for (let round = 0; round < 5; round += 1) {
          times.push(await page.evaluate(EXACT_FRAME));
          await sleep(300);
        }
        return times;
      };
      const times = await exactFrames("latencias-vista", false);
      const stats = summarize(times);
      report.metric(
        "vista exacta, muestras en orden",
        times.map((ms) => ms.toFixed(0)).join(" / "),
        "ms",
      );
      report.metric("vista exacta (p50)", stats.p50.toFixed(0), "ms");
      report.metric("vista exacta (máx.)", stats.max.toFixed(0), "ms");
      report.check(
        "la vista exacta tarda ≤ 1 s en todas las muestras",
        stats.max <= 1000,
        `máx=${stats.max.toFixed(0)} ms`,
      );
      const settled = await exactFrames("latencias-vista-asentada", true);
      report.metric(
        "vista exacta tras asentar las miniaturas, muestras en orden",
        settled.map((ms) => ms.toFixed(0)).join(" / "),
        "ms",
      );
    });

    await report.step("reproducción sostenida de un 1080p con GOP de 12 s", async () => {
      await openSession("latencias-reproduccion");
      await host.queueOpen([projectHd]);
      await page.click(L.open);
      await page.waitForText("0:10.00", { selector: ".editor-timeline-head", timeout: 60000 });
      for (let i = 0; i < 3; i += 1) await clickBy(`button[aria-label="${L.zoomIn}"]`);
      await clickBy(`.editor-transport button[aria-label="${L.play}"]`);
      const { frames, seconds } = await page.evaluate(PRESENTED_FRAMES(5));
      const headInView = await page.evaluate(`(() => {
        const view = document.querySelector(".editor-timeline-viewport");
        const head = parseFloat(document.querySelector(".editor-playhead")?.style.left ?? "NaN");
        return { offset: head - view.scrollLeft, width: view.clientWidth };
      })()`);
      await clickBy(`.editor-transport button[aria-label="${L.pause}"]`);
      const fps = frames / seconds;
      report.metric("fotogramas presentados al reproducir 1080p", fps.toFixed(1), "fps");
      report.check(
        "la reproducción 1080p se sostiene a ≥ 29 fps (objetivo 30; 1 fps de margen para contar fotogramas)",
        fps >= 29,
        `${fps.toFixed(1)} fps`,
      );
      report.check(
        "el cabezal sigue dentro de la vista durante la reproducción",
        headInView.offset >= 0 && headInView.offset <= headInView.width,
        `desplazamiento ${headInView.offset.toFixed(0)} px en una vista de ${headInView.width} px`,
      );
    });

    await report.step("filmstrip de un montaje de 30 clips", async () => {
      await host.queueOpen([projectMany]);
      const opened = Date.now();
      await page.click(L.open);
      await waitUntil(
        () => page.evaluate(`document.querySelectorAll(".timeline-clip").length === 30`),
        { timeout: 60000, label: "30 clips" },
      );
      let last = -1;
      let stableSince = null;
      let settled = null;
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        const count = await page.evaluate(
          `document.querySelectorAll(".timeline-clip-frames img").length`,
        );
        if (count !== last) {
          last = count;
          stableSince = Date.now();
        } else if (Date.now() - stableSince > 1000) {
          settled = Date.now() - opened;
          break;
        }
        await sleep(100);
      }
      const empty = await page.evaluate(
        `document.querySelectorAll(".timeline-clip-frame-empty").length`,
      );
      report.metric(
        "filmstrip estable tras abrir 30 clips",
        settled === null ? "no estable" : (settled / 1000).toFixed(2),
        "s",
      );
      report.metric("miniaturas cargadas / huecos vacíos", `${last} / ${empty}`, "");
      report.check("el filmstrip se estabiliza en 30 s", settled !== null);
    });
  } finally {
    if (page) {
      report.check(
        "la pantalla no quedó con error visible",
        !(await page
          .evaluate(`Boolean(document.querySelector('[role="alert"]'))`)
          .catch(() => true)),
      );
    }
    await session?.stop();
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
