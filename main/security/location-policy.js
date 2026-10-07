import path from "path";

const DENIED_PATH_FRAGMENTS = [
  "\\windows\\system32",
  "\\windows\\syswow64",
  "\\program files\\windowsapps",
];

const TRUSTED_ROOT_NAMES = [
  "userData",
  "temp",
  "home",
  "documents",
  "downloads",
  "desktop",
  "videos",
  "music",
  "pictures",
];

const TRUSTED_ROOTS_TTL_MS = 30_000;

export function createLocationPolicy({
  app,
  resolveSafe,
  resolveSafeAsync,
  normalizeKey,
  now = () => Date.now(),
  warn = console.warn,
  resourcesPath = process.resourcesPath,
}) {
  let cachedRoots = null;
  let cacheTime = 0;

  const rootPaths = () => {
    const collected = [];
    for (const name of TRUSTED_ROOT_NAMES) {
      try {
        const p = app.getPath(name);
        if (p) collected.push(p);
      } catch (e) {
        warn(`[beru][security] Failed to get path for ${name}:`, e?.message || e);
      }
    }
    collected.push(app.isPackaged && resourcesPath ? resourcesPath : app.getAppPath());
    return collected.filter(Boolean);
  };

  const roots = () => {
    const nowMs = now();
    if (cachedRoots && nowMs - cacheTime < TRUSTED_ROOTS_TTL_MS) return cachedRoots;
    cachedRoots = rootPaths()
      .map((r) => resolveSafe(r))
      .filter(Boolean)
      .map((r) => normalizeKey(r));
    cacheTime = nowMs;
    return cachedRoots;
  };

  function isDenied(resolved) {
    const key = normalizeKey(resolved);
    return DENIED_PATH_FRAGMENTS.some((frag) => key.includes(frag));
  }

  function isUnderRoot(resolved) {
    const key = normalizeKey(resolved);
    return roots().some((root) => key === root || key.startsWith(`${root}${path.sep}`));
  }

  let pendingRoots = null;
  async function isUnderRootAsync(resolved) {
    if (!cachedRoots || now() - cacheTime >= TRUSTED_ROOTS_TTL_MS) {
      if (!pendingRoots) {
        pendingRoots = Promise.all(rootPaths().map(resolveSafeAsync))
          .then((paths) => {
            cachedRoots = paths.filter(Boolean).map(normalizeKey);
            cacheTime = now();
          })
          .finally(() => {
            pendingRoots = null;
          });
      }
      await pendingRoots;
    }
    const key = normalizeKey(resolved);
    return cachedRoots.some((root) => key === root || key.startsWith(`${root}${path.sep}`));
  }

  return { isDenied, isUnderRoot, isUnderRootAsync };
}
