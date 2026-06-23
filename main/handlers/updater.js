import { ipcMain, shell } from "electron";
import * as updater from "../updater.js";

const APPROVED_EXTERNAL_DOMAINS = ["github.com", "beru.app"];

function isPrivateOrLocalHostname(hostname) {
  const host = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost") || host === "::1" || host === "::") {
    return true;
  }
  if (host.startsWith("fc") || host.startsWith("fd") || /^fe[89ab]/.test(host)) {
    return true;
  }
  const octets = host.split(".").map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value))) return false;
  const [first, second] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function isApprovedExternalUrl(value) {
  if (typeof value !== "string") return false;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) return false;
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (isPrivateOrLocalHostname(hostname)) return false;
  return APPROVED_EXTERNAL_DOMAINS.some(
    (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
  );
}

export function registerUpdaterHandlers() {
  ipcMain.handle("updater:check", async () => {
    return await updater.checkForUpdates();
  });

  ipcMain.handle("updater:download", async (_event, opts) => {
    return await updater.startDownload(opts);
  });

  ipcMain.handle("updater:install", () => {
    return updater.install();
  });

  ipcMain.handle("updater:getSnapshot", () => {
    return updater.getSnapshot();
  });

  ipcMain.handle("shell:openExternal", async (_event, url) => {
    if (!isApprovedExternalUrl(url)) {
      return { success: false, error: "URL externa no permitida" };
    }
    try {
      await shell.openExternal(url);
      return { success: true };
    } catch (e) {
      return { success: false, error: e?.message || String(e) };
    }
  });
}
