import { ipcMain } from "electron";
import path from "path";
import { fileURLToPath } from "url";
import { isDev, DEV_URL } from "../shared-state.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const APP_DOCUMENTS = [
  path.join(__dirname, "..", "..", "build", "index.html"),
  path.join(__dirname, "..", "..", "build", "pet-overlay.html"),
];

function normalizeDocPath(p) {
  return path.resolve(p).toLowerCase();
}

function isDevDocumentUrl(url) {
  if (!isDev) return false;
  try {
    const doc = new URL(DEV_URL);
    const target = new URL(url);
    return target.origin === doc.origin && target.pathname.startsWith(doc.pathname);
  } catch {
    return false;
  }
}

export function isTrustedDocumentUrl(url) {
  if (typeof url !== "string" || !url) return false;
  if (isDevDocumentUrl(url)) return true;
  if (!url.startsWith("file:")) return false;
  try {
    const docPath = normalizeDocPath(fileURLToPath(url));
    return APP_DOCUMENTS.some((doc) => normalizeDocPath(doc) === docPath);
  } catch {
    return false;
  }
}

export function isTrustedSender(event) {
  return Boolean(event?.senderFrame && isTrustedDocumentUrl(event.senderFrame.url));
}

export function handleIpc(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!isTrustedSender(event)) {
      console.error("[beru] ipc rejected untrusted sender:", channel);
      return { success: false, error: "untrusted sender" };
    }
    try {
      return await fn(event, ...args);
    } catch (err) {
      console.error(`[beru] ipc ${channel} failed:`, err?.message || err);
      return { success: false, error: err?.message || String(err) };
    }
  });
}
