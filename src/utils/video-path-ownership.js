import { swallow } from "./swallow.js";

const key = (path) => path.replace(/\\/g, "/").toLowerCase();

export function releaseUnownedVideoPaths(paths, state) {
  if (!window.api?.releaseVideoPaths) return;
  const retainedPaths = [
    ...state.queue.map((item) => item.path),
    ...(state.composition?.entries.map((entry) => entry.item.path) || []),
  ];
  const retained = new Set(retainedPaths.map(key));
  const released = [...new Set(paths)].filter((path) => !retained.has(key(path)));
  for (let offset = 0; offset < released.length; offset += 500) {
    void Promise.resolve(
      window.api.releaseVideoPaths(released.slice(offset, offset + 500), retainedPaths),
    ).catch((error) => swallow("releaseVideoPaths", error));
  }
}
