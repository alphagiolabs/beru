import { execFile } from "child_process";

export function killProcessTree(proc) {
  if (!proc?.pid) return Promise.resolve();
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
