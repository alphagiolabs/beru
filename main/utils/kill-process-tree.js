import { execFile } from "child_process";

export function killProcessTree(proc) {
  if (!proc?.pid) return Promise.resolve();
  if (process.platform === "win32") {
    return new Promise((resolve) => {
      execFile("taskkill", ["/F", "/T", "/PID", String(proc.pid)], { windowsHide: true }, (err) => {
        if (err) {
          console.error("[beru] taskkill error:", err.message);
          try {
            proc.kill();
          } catch {}
        }
        resolve();
      });
    });
  }
  try {
    proc.kill("SIGTERM");
  } catch {}
  return Promise.resolve();
}
