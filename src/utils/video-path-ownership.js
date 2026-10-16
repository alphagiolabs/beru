import { swallow } from "./swallow.js";

const key = (path) => path.replace(/\\/g, "/").toLowerCase();
const owners = new Map();

export function setVideoPathOwners(updates) {
  const previousPaths = [];
  for (const [owner, paths] of Object.entries(updates)) {
    const previous = owners.get(owner) ?? [];
    const next = [...new Set(paths)];
    const retained = new Set(next.map(key));
    previousPaths.push(...previous.filter((path) => !retained.has(key(path))));
    if (next.length) owners.set(owner, next);
    else owners.delete(owner);
  }
  if (typeof window === "undefined" || !window.api?.releaseVideoPaths || !previousPaths.length)
    return;
  const retainedPaths = [...new Set([...owners.values()].flat())];
  const retained = new Set(retainedPaths.map(key));
  const released = [...new Set(previousPaths)].filter((path) => !retained.has(key(path)));
  for (let offset = 0; offset < released.length; offset += 500) {
    void Promise.resolve(
      window.api.releaseVideoPaths(released.slice(offset, offset + 500), retainedPaths),
    ).catch((error) => swallow("releaseVideoPaths", error));
  }
}
