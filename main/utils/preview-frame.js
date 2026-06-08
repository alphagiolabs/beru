import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { randomBytes } from "crypto";
import { app } from "electron";
import { getPythonPath } from "./paths.js";

function resolvePythonSpawn() {
  if (process.env.BERU_PYTHON && fs.existsSync(process.env.BERU_PYTHON)) {
    return { command: process.env.BERU_PYTHON, args: [] };
  }
  if (process.platform === "win32") {
    return { command: "py", args: ["-3"] };
  }
  return { command: "python3", args: [] };
}

export async function renderPreviewFrame(payload) {
  const pythonScript = getPythonPath();
  if (!pythonScript || !fs.existsSync(pythonScript)) {
    return { ok: false, error: "Procesador Python no encontrado" };
  }

  const tmpFile = path.join(
    app.getPath("temp"),
    `beru-preview-${randomBytes(8).toString("hex")}.json`,
  );

  try {
    await fs.promises.writeFile(tmpFile, JSON.stringify(payload), "utf8");
  } catch (err) {
    return { ok: false, error: err.message };
  }

  return new Promise((resolve) => {

    const { command, args: pyArgs } = resolvePythonSpawn();
    const proc = spawn(command, [...pyArgs, pythonScript, "--preview-frame", tmpFile], {
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const killTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        proc.kill();
      } catch {}
      fs.promises.unlink(tmpFile).catch(() => {});
      resolve({ ok: false, error: "Timeout al renderizar el frame" });
    }, 60_000);

    proc.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    proc.stderr.on("data", (d) => {
      stderr += d.toString();
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });

    proc.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      fs.promises.unlink(tmpFile).catch(() => {});
      resolve({ ok: false, error: err.message });
    });

    proc.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      fs.promises.unlink(tmpFile).catch(() => {});

      const trimmed = stdout.trim();
      if (trimmed) {
        try {
          const parsed = JSON.parse(trimmed);
          return resolve(parsed);
        } catch {
          /* fall through */
        }
      }

      resolve({
        ok: false,
        error: stderr.trim() || `Preview frame failed (exit ${code ?? "?"})`,
      });
    });
  });
}
