import { spawn } from "child_process";
import http from "http";
import net from "net";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { shouldRestartElectronForPythonChange } from "./dev-python-watch.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const preferredPort = Number(process.env.BERU_DEV_PORT || 5173);
const maxPort = preferredPort + 50;
const isWindows = process.platform === "win32";

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen({ port, host: "localhost" }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function pickPort() {
  for (let port = preferredPort; port <= maxPort; port += 1) {
    if (await isPortFree(port)) return port;
  }
  throw new Error(`No free dev port found between ${preferredPort} and ${maxPort}`);
}

function spawnLocal(command, args, env) {
  return spawn(command, args, {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
}

function prefixOutput(name, stream) {
  let buffer = "";
  stream.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (line) console.log(`[${name}] ${line}`);
    }
  });
  stream.on("end", () => {
    if (buffer) console.log(`[${name}] ${buffer}`);
  });
}

function waitForHttp(url, timeoutMs = 30000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() - started > timeoutMs) {
          reject(new Error(`Timed out waiting for ${url}`));
          return;
        }
        setTimeout(poll, 250);
      });
      req.setTimeout(1000, () => req.destroy());
    };
    poll();
  });
}

function killTree(child) {
  if (!child?.pid || child.killed) return;
  if (isWindows) {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
  } else {
    child.kill("SIGTERM");
  }
}

const port = await pickPort();
const devUrl = `http://localhost:${port}`;
const env = {
  ...process.env,
  BERU_DEV_PORT: String(port),
  BERU_DEV_URL: devUrl,
};

if (port !== preferredPort) {
  console.warn(`[dev] Port ${preferredPort} is busy; using ${port}.`);
}

const viteBin = path.join(root, "node_modules", "vite", "bin", "vite.js");
const electronBin = path.join(root, "node_modules", "electron", "cli.js");
const vite = spawnLocal(
  process.execPath,
  [viteBin, "--host", "localhost", "--port", String(port), "--strictPort"],
  env,
);
let electron = null;
let shuttingDown = false;

prefixOutput("vite", vite.stdout);
prefixOutput("vite", vite.stderr);

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  killTree(electron);
  killTree(vite);
  setTimeout(() => process.exit(code), 500).unref();
}

vite.on("exit", (code) => {
  if (!shuttingDown) shutdown(code ?? 1);
});

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

try {
  await waitForHttp(devUrl);
  electron = spawnLocal(process.execPath, [electronBin, "."], env);
  prefixOutput("electron", electron.stdout);
  prefixOutput("electron", electron.stderr);
  let electronExitHandler = (code) => shutdown(code ?? 0);
  electron.on("exit", electronExitHandler);

  // Watch runtime processor modules — restart Electron (not Vite) when they
  // change. Ignore test_*.py / scratch scripts so editing tests does not
  // bounce the app window (see scripts/dev-python-watch.mjs).
  const pythonDir = path.join(root, "python");
  let restartTimer = null;
  try {
    fs.watch(pythonDir, { recursive: false }, (_eventType, filename) => {
      if (!shouldRestartElectronForPythonChange(filename)) return;
      // Debounce rapid saves
      if (restartTimer) clearTimeout(restartTimer);
      restartTimer = setTimeout(() => {
        restartTimer = null;
        if (shuttingDown || !electron) return;
        console.log(`[dev] Python file changed (${filename}), restarting Electron...`);
        // Remove the OLD exit handler before killing so the old process's
        // exit (triggered by killTree) doesn't call shutdown() and tear down
        // Vite + the new Electron we're about to spawn.
        const oldProc = electron;
        const oldHandler = electronExitHandler;
        if (oldProc) oldProc.removeListener("exit", oldHandler);
        killTree(oldProc);
        electron = spawnLocal(process.execPath, [electronBin, "."], env);
        prefixOutput("electron", electron.stdout);
        prefixOutput("electron", electron.stderr);
        electronExitHandler = (code) => shutdown(code ?? 0);
        electron.on("exit", electronExitHandler);
      }, 500);
    });
  } catch {
    console.warn("[dev] Python file watcher could not be started (non-critical)");
  }
} catch (err) {
  console.error(`[dev] ${err.message}`);
  shutdown(1);
}
