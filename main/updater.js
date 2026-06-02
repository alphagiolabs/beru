/* Updater wrapper around electron-updater with safe defaults.
 *
 * - Disabled in dev (isDev === true) so local builds don't try to phone home.
 * - Forwards every electron-updater event to the renderer via the
 *   "updater:event" IPC channel so the UI can react.
 * - All public methods resolve; they never throw to the caller.
 */

import { app } from "electron";
import { createRequire } from "module";

const isDev = !app.isPackaged;
const requireCJS = createRequire(import.meta.url);

let autoUpdater = null;
let initialized = false;
let mainWindow = null;

const tryLoad = () => {
  if (autoUpdater) return autoUpdater;
  try {
    const { autoUpdater: au } = requireCJS("electron-updater");
    autoUpdater = au;
    return autoUpdater;
  } catch (e) {
    console.warn("[updater] electron-updater not available:", e.message);
    return null;
  }
};

const send = (payload) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    try { mainWindow.webContents.send("updater:event", payload); } catch {}
  }
};

const init = (win) => {
  if (initialized) return;
  initialized = true;
  mainWindow = win;
  if (isDev) {
    send({ type: "disabled", reason: "dev-build" });
    return;
  }
  const au = tryLoad();
  if (!au) {
    send({ type: "disabled", reason: "missing-module" });
    return;
  }
  au.autoDownload = true;
  au.autoInstallOnAppQuit = false;
  au.logger = null;

  au.on("checking-for-update", () => send({ type: "checking" }));
  au.on("update-available", (info) => send({ type: "available", version: info?.version, releaseDate: info?.releaseDate }));
  au.on("update-not-available", (info) => send({ type: "not-available", version: info?.version }));
  au.on("download-progress", (p) => send({ type: "downloading", percent: p?.percent ?? 0, transferred: p?.transferred, total: p?.total }));
  au.on("update-downloaded", (info) => send({ type: "ready", version: info?.version }));
  au.on("error", (err) => send({ type: "error", message: err?.message || String(err) }));
};

const checkForUpdates = async () => {
  if (isDev) return { ok: false, reason: "dev-build" };
  const au = tryLoad();
  if (!au) return { ok: false, reason: "missing-module" };
  try {
    const result = await au.checkForUpdates();
    return { ok: true, version: result?.updateInfo?.version };
  } catch (e) {
    send({ type: "error", message: e?.message || String(e) });
    return { ok: false, error: e?.message };
  }
};

const startDownload = async () => {
  if (isDev) return { ok: false, reason: "dev-build" };
  const au = tryLoad();
  if (!au) return { ok: false, reason: "missing-module" };
  try {
    await au.downloadUpdate();
    return { ok: true };
  } catch (e) {
    send({ type: "error", message: e?.message || String(e) });
    return { ok: false, error: e?.message };
  }
};

const install = () => {
  if (isDev) return;
  const au = tryLoad();
  if (!au) return;
  try { au.quitAndInstall(false, true); } catch {}
};

/* ── GitHub Releases check (renderer-driven banner) ──────────────────────
 *
 * - Uses `app.getVersion()` as source of truth (not the renderer).
 * - Server-side fetch, so the renderer never hits GitHub's CORS / rate limit.
 * - Skips drafts and prereleases; picks the highest stable semver.
 * - Finds the Windows installer asset when present.
 */

const parseSemver = (v) => {
  const s = (v || "").replace(/^v/i, "").trim();
  const core = s.split("-")[0].split(".").map((n) => {
    const x = parseInt(n, 10);
    return Number.isFinite(x) ? x : 0;
  });
  const i = s.indexOf("-");
  const pre = i === -1 ? [] : s.slice(i + 1).split(".").map((p) =>
    /^\d+$/.test(p) ? Number(p) : p
  );
  return { core, pre };
};

const compareSemver = (a, b) => {
  const A = parseSemver(a);
  const B = parseSemver(b);
  const len = Math.max(A.core.length, B.core.length);
  for (let i = 0; i < len; i++) {
    const na = A.core[i] || 0;
    const nb = B.core[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  if (A.pre.length === 0 && B.pre.length > 0) return 1;
  if (A.pre.length > 0 && B.pre.length === 0) return -1;
  const plen = Math.max(A.pre.length, B.pre.length);
  for (let i = 0; i < plen; i++) {
    const na = A.pre[i];
    const nb = B.pre[i];
    if (na == null && nb != null) return -1;
    if (na != null && nb == null) return 1;
    if (typeof na === "number" && typeof nb === "number") {
      if (na > nb) return 1;
      if (na < nb) return -1;
    } else {
      const sa = String(na);
      const sb = String(nb);
      if (sa > sb) return 1;
      if (sa < sb) return -1;
    }
  }
  return 0;
};

const pickInstaller = (assets) => {
  if (!Array.isArray(assets)) return null;
  const exe = assets.find((a) => /\.exe$/i.test(a?.name || "") && !/\.blockmap$/i.test(a?.name || ""));
  return exe?.browser_download_url || null;
};

const findLatestStable = (releases) => {
  if (!Array.isArray(releases)) return null;
  const stable = releases.filter((r) => r && !r.draft && !r.prerelease && r.tag_name);
  if (stable.length === 0) return null;
  let best = stable[0];
  for (const r of stable.slice(1)) {
    if (compareSemver(r.tag_name, best.tag_name) > 0) best = r;
  }
  return best;
};

const checkGitHubRelease = async () => {
  const currentVersion = app.getVersion();
  const owner = "alphagiolabs";
  const repo = "beru";
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/releases?per_page=20`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(apiUrl, {
      signal: controller.signal,
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": `Beru/${currentVersion}`,
      },
    });
    if (!res.ok) {
      return { ok: false, error: `GitHub API ${res.status}`, currentVersion };
    }
    const data = await res.json();
    const latest = findLatestStable(data);
    if (!latest || !latest.tag_name) {
      return { ok: true, updateAvailable: false, currentVersion };
    }
    const tag = (latest.tag_name || "").replace(/^v/i, "").trim();
    const updateAvailable = compareSemver(tag, currentVersion) > 0;
    return {
      ok: true,
      updateAvailable,
      currentVersion,
      latest: updateAvailable
        ? {
            version: tag,
            tagName: latest.tag_name,
            name: latest.name || tag,
            htmlUrl: latest.html_url,
            installerUrl: pickInstaller(latest.assets),
            assets: Array.isArray(latest.assets)
              ? latest.assets.map((a) => ({ name: a.name, url: a.browser_download_url, size: a.size }))
              : [],
            publishedAt: latest.published_at,
            body: latest.body || "",
          }
        : null,
    };
  } catch (e) {
    return { ok: false, error: e?.message || String(e), currentVersion };
  } finally {
    clearTimeout(timer);
  }
};

export { init, checkForUpdates, startDownload, install, isDev, checkGitHubRelease };
