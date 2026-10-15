import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";

const CHROME =
  process.env.F0_CHROME ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT_CDP = 9337;
const PAGE = "http://127.0.0.1:5199/";
const profile = path.resolve(".tmp/editor-f0/chrome-profile");
mkdirSync(profile, { recursive: true });

const MEDIA = [
  "/media/fixtures/cfr-25.mp4",
  "/media/fixtures/cfr-30.mp4",
  "/media/fixtures/ntsc-30000-1001.mp4",
  "/media/fixtures/vfr-30-gaps.mp4",
  "/media/fixtures/vertical-rotated-90.mp4",
  "/media/fixtures/no-audio-30.mp4",
  "/media/fixtures/prores-422-mov.mov",
  "/media/fixtures/hd-1080-30-detail-long-gop.mp4",
  "/media/proxies/p540-gop15.mp4",
  "/media/proxies/p540-intra.mp4",
  "/media/proxies/p720-gop30.mp4",
  "/media/proxies/p540-gop15-from-prores.mp4",
];
const FLAGS = [
  "--headless=new",
  `--remote-debugging-port=${PORT_CDP}`,
  `--user-data-dir=${profile}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--autoplay-policy=no-user-gesture-required",
  "--disable-background-timer-throttling",
  "--disable-renderer-backgrounding",
  "--disable-backgrounding-occluded-windows",
  "--window-size=1280,800",
  "about:blank",
];

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const cdp = (p) => fetch(`http://127.0.0.1:${PORT_CDP}${p}`).then((r) => r.json());

const chrome = spawn(CHROME, FLAGS, { stdio: "ignore" });
try {
  let version = null;
  for (let i = 0; i < 100 && !version; i++) {
    try {
      version = await cdp("/json/version");
    } catch {
      await delay(200);
    }
  }
  if (!version) throw new Error("Chrome did not expose its DevTools endpoint");
  const target = await fetch(`http://127.0.0.1:${PORT_CDP}/json/new?${encodeURIComponent(PAGE)}`, {
    method: "PUT",
  }).then((r) => r.json());

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let nextId = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  };
  const evaluate = async (expression) => {
    const id = ++nextId;
    const reply = await new Promise((resolve) => {
      pending.set(id, resolve);
      ws.send(
        JSON.stringify({
          id,
          method: "Runtime.evaluate",
          params: { expression, awaitPromise: true, returnByValue: true },
        }),
      );
    });
    if (reply.result.exceptionDetails)
      throw new Error(JSON.stringify(reply.result.exceptionDetails));
    return reply.result.result.value;
  };

  for (let i = 0; i < 100; i++) {
    if ((await evaluate("document.readyState")) === "complete") break;
    await delay(100);
  }

  await evaluate(
    `window.F0.save('browser-run.json', ${JSON.stringify({
      chrome: version.Browser,
      userAgent: version["User-Agent"],
      flags: FLAGS.filter((f) => f !== "about:blank"),
      headless: true,
      sources: MEDIA,
    })})`,
  );
  const probed = await evaluate(`window.F0.probe(${JSON.stringify(MEDIA)})`);
  for (const r of probed.results)
    console.log(`probe ${r.outcome.padEnd(11)} ${r.width}x${r.height} ${r.url}`);

  const args = process.argv.slice(2);
  if (process.env.F0_EXPR)
    console.log(JSON.stringify(await evaluate(process.env.F0_EXPR), null, 1));
  const suites = args.length ? args.filter((s) => s !== "none") : ["playback", "seeks", "switches"];
  for (const suite of suites) {
    await evaluate(`window.F0_suite('${suite}')`);
    for (;;) {
      await delay(1000);
      const state = await evaluate(
        "({ state: window.F0_progress.state, message: window.F0_progress.message, done: window.F0_progress.done.length })",
      );
      if (state.state === "done") break;
      if (state.state === "error") throw new Error(`${suite}: ${state.message}`);
    }
    console.log(`${suite}: done`);
  }
  ws.close();
} finally {
  chrome.kill();
}
