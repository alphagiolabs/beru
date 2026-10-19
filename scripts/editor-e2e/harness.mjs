import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const RUN_ROOT = path.join(REPO, ".tmp", "editor-e2e");
const FFMPEG = path.join(REPO, "bin", "ffmpeg.exe");
const FFPROBE = path.join(REPO, "bin", "ffprobe.exe");
const ELECTRON = path.join(REPO, "node_modules", "electron", "dist", "electron.exe");
const VITE_CLI = path.join(REPO, "node_modules", "vite", "bin", "vite.js");

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitUntil(
  check,
  { timeout = 30000, interval = 250, label = "condition" } = {},
) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeout) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(interval);
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ""}`);
}

function startRenderer(port, args = []) {
  const child = spawn(
    process.execPath,
    [
      VITE_CLI,
      ...args,
      "--config",
      "scripts/editor-e2e/vite.config.mjs",
      "--host",
      "localhost",
      "--port",
      String(port),
      "--strictPort",
    ],
    { cwd: REPO, stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  );
  child.stderr.on("data", () => {});
  return child;
}

export function startVite(port) {
  return startRenderer(port);
}

const RENDERER_PROD = path.join(RUN_ROOT, "renderer-prod");

export function startPreview(port) {
  return startRenderer(port, ["preview", "--outDir", RENDERER_PROD]);
}

export function buildRendererProd() {
  execFileSync(process.execPath, [VITE_CLI, "build", "--outDir", RENDERER_PROD, "--emptyOutDir"], {
    cwd: REPO,
    stdio: "ignore",
  });
}

export function launchElectron({ devUrl, exe, rendererPort, inspectPort, profileDir }) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  if (exe) {
    delete env.BERU_DEV_URL;
    delete env.BERU_USE_BUNDLED;
  } else {
    env.BERU_DEV_URL = devUrl;
    env.BERU_USE_BUNDLED = "1";
  }
  const child = spawn(
    exe ?? ELECTRON,
    [
      ...(exe ? [] : [REPO]),
      "--no-sandbox",
      "--disable-gpu",
      `--remote-debugging-port=${rendererPort}`,
      `--inspect=${inspectPort}`,
      `--user-data-dir=${profileDir}`,
    ],
    { cwd: REPO, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  );
  child.stdout.on("data", () => {});
  child.stderr.on("data", () => {});
  return child;
}

class Cdp {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
  }

  open() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url, {
        perMessageDeflate: false,
        maxPayload: 256 * 1024 * 1024,
      });
      this.ws.on("open", resolve);
      this.ws.on("error", reject);
      this.ws.on("message", (raw) => {
        const message = JSON.parse(raw.toString());
        if (message.id && this.pending.has(message.id)) {
          const { resolve: done, reject: fail } = this.pending.get(message.id);
          this.pending.delete(message.id);
          if (message.error) fail(new Error(`${message.error.message}`));
          else done(message.result ?? {});
        } else if (message.method && this.listeners.has(message.method)) {
          for (const listener of this.listeners.get(message.method)) listener(message.params);
        }
      });
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression, label) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      const detail = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text;
      throw new Error(`${label} error: ${detail}`);
    }
    return result.result.value;
  }

  on(method, listener) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(listener);
  }

  close() {
    this.ws?.close();
  }
}

async function targetUrl(port, match) {
  return waitUntil(
    async () => {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const found = targets.find(match);
      return found?.webSocketDebuggerUrl ?? null;
    },
    { label: `debugger target on port ${port}`, timeout: 60000 },
  );
}

export async function connectPage(rendererPort, devUrl) {
  const match = devUrl
    ? (t) => t.type === "page" && t.url.startsWith(devUrl)
    : (t) => t.type === "page" && /index\.html/.test(t.url);
  const url = await targetUrl(rendererPort, match);
  const cdp = new Cdp(url);
  await cdp.open();
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Page.bringToFront");
  await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  return new Page(cdp);
}

export async function connectMain(inspectPort) {
  const url = await targetUrl(inspectPort, (t) => t.type === "node" || /beru/i.test(t.title ?? ""));
  const cdp = new Cdp(url);
  await cdp.open();
  await cdp.send("Runtime.enable");
  return new Main(cdp);
}

export class Page {
  constructor(cdp) {
    this.cdp = cdp;
  }

  evaluate(expression) {
    return this.cdp.evaluate(expression, "Renderer");
  }

  click(text, scope = "document") {
    return this.evaluate(`(() => {
      const root = ${scope === "document" ? "document" : `document.querySelector(${JSON.stringify(scope)})`};
      if (!root) return false;
      const button = [...root.querySelectorAll("button")].find(
        (b) => b.textContent.trim() === ${JSON.stringify(text)} && b.offsetParent !== null && !b.disabled,
      );
      if (!button) return false;
      button.click();
      return true;
    })()`);
  }

  setInput(selector, value) {
    return this.evaluate(`(() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      if (!input) return false;
      input.focus();
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(input, ${JSON.stringify(String(value))});
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.blur();
      return true;
    })()`);
  }

  async elementCenter(selector) {
    const point = await this.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      el.scrollIntoView({ block: "center", inline: "center" });
      const rect = el.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    if (!point) throw new Error(`No element for ${selector}`);
    return point;
  }

  async mouseClick(selector) {
    const point = await this.elementCenter(selector);
    const base = { x: point.x, y: point.y, button: "left", clickCount: 1 };
    await this.cdp.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: point.x,
      y: point.y,
      buttons: 0,
    });
    await this.cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", ...base, buttons: 1 });
    await this.cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...base, buttons: 0 });
  }

  async mouseDrag(selector, dx, dy = 0, { steps = 16, pauseMs = 0 } = {}) {
    const start = await this.elementCenter(selector);
    const move = (type, x, y, buttons) =>
      this.cdp.send("Input.dispatchMouseEvent", {
        type,
        x,
        y,
        button: "left",
        buttons,
        clickCount: type === "mouseMoved" ? 0 : 1,
      });
    await move("mouseMoved", start.x, start.y, 0);
    await move("mousePressed", start.x, start.y, 1);
    for (let step = 1; step <= steps; step += 1) {
      await move("mouseMoved", start.x + (dx * step) / steps, start.y + (dy * step) / steps, 1);
      if (pauseMs > 0) await sleep(pauseMs);
    }
    await move("mouseReleased", start.x + dx, start.y + dy, 0);
  }

  text(selector) {
    return this.evaluate(
      `document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`,
    );
  }

  waitForText(text, { selector = "body", timeout = 30000 } = {}) {
    return waitUntil(
      () =>
        this.evaluate(
          `(document.querySelector(${JSON.stringify(selector)})?.innerText ?? "").includes(${JSON.stringify(text)})`,
        ),
      { timeout, label: `text "${text}"` },
    );
  }

  waitForButton(text, { timeout = 30000 } = {}) {
    return waitUntil(
      () =>
        this.evaluate(
          `[...document.querySelectorAll("button")].some((b) => b.textContent.trim() === ${JSON.stringify(text)} && b.offsetParent !== null)`,
        ),
      { timeout, label: `button "${text}"` },
    );
  }

  waitForButtonGone(text, { timeout = 600000 } = {}) {
    return waitUntil(
      async () =>
        !(await this.evaluate(
          `[...document.querySelectorAll("button")].some((b) => b.textContent.trim() === ${JSON.stringify(text)} && b.offsetParent !== null)`,
        )),
      { timeout, label: `button "${text}" to disappear`, interval: 500 },
    );
  }

  async screenshot(file) {
    const { data } = await this.cdp.send("Page.captureScreenshot", { format: "png" });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(data, "base64"));
    return file;
  }

  async viewport({ width, height, scale = 1 }) {
    await this.cdp.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: scale,
      mobile: false,
    });
  }

  async pressKey(key, { code = "", ctrlKey = false, shiftKey = false } = {}) {
    await this.evaluate(
      `window.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(key)}, code: ${JSON.stringify(code)}, ctrlKey: ${ctrlKey}, shiftKey: ${shiftKey}, bubbles: true }))`,
    );
  }

  close() {
    this.cdp.close();
  }
}

export class Main {
  constructor(cdp) {
    this.cdp = cdp;
  }

  evaluate(expression) {
    return this.cdp.evaluate(expression, "Main process");
  }

  installDialogStubs() {
    return this.evaluate(`(() => {
      const electron = process.mainModule.require("electron");
      const state = globalThis.__beruE2E = globalThis.__beruE2E || { opens: [], saves: [], calls: [] };
      electron.dialog.showOpenDialog = async (_window, options) => {
        state.calls.push({ type: "open", title: options.title });
        const next = state.opens.shift();
        return next ? { canceled: false, filePaths: next } : { canceled: true, filePaths: [] };
      };
      electron.dialog.showSaveDialog = async (_window, options) => {
        state.calls.push({ type: "save", title: options.title });
        const next = state.saves.shift();
        return next ? { canceled: false, filePath: next } : { canceled: true, filePath: undefined };
      };
      return true;
    })()`);
  }

  queueOpen(paths) {
    return this.evaluate(`globalThis.__beruE2E.opens.push(${JSON.stringify(paths)})`);
  }

  queueSave(filePath) {
    return this.evaluate(`globalThis.__beruE2E.saves.push(${JSON.stringify(filePath)})`);
  }

  dialogCalls() {
    return this.evaluate(`globalThis.__beruE2E.calls.splice(0)`);
  }

  memory() {
    return this.evaluate(
      `(() => { const m = process.memoryUsage(); return { rss: m.rss, heapUsed: m.heapUsed }; })()`,
    );
  }

  quit() {
    return this.evaluate(
      `(() => { process.mainModule.require("electron").app.quit(); return true; })()`,
    );
  }

  close() {
    this.cdp.close();
  }
}

export function killTree(child) {
  if (!child || child.exitCode !== null || !child.pid) return Promise.resolve();
  return new Promise((resolve) => {
    const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
    });
    killer.on("exit", () => resolve());
    killer.on("error", () => resolve());
  });
}

export function probe(file) {
  const out = execFileSync(
    FFPROBE,
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration:stream=codec_type,width,height",
      "-of",
      "json",
      file,
    ],
    { encoding: "utf8", windowsHide: true },
  );
  const info = JSON.parse(out);
  const video = info.streams.find((s) => s.codec_type === "video");
  const audio = info.streams.find((s) => s.codec_type === "audio");
  return {
    durationS: Number(info.format.duration),
    width: video?.width ?? null,
    height: video?.height ?? null,
    hasAudio: Boolean(audio),
  };
}

export function ffmpeg(args) {
  execFileSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", ...args], {
    windowsHide: true,
  });
}

export function translations(lang) {
  const file = path.join(REPO, "src", "i18n", "messages", `${lang}.json`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export { FFMPEG, FFPROBE };
