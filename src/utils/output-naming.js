import { buildIdTextOutputName } from "./batch-process.js";
import { stripExt } from "./video-utils.js";

function itemStem(item) {
  return stripExt(item.path.split(/[\\/]/).pop());
}

function namingIndexOf(queue, item) {
  return queue.findIndex((q) => q === item || q.path === item.path);
}

function desiredOutputName(item, videoIdx, naming) {
  if (!item) return null;
  const { templateRegions = [], exportFormat, cellText, displayId } = naming;
  const stem = itemStem(item);
  let outputName = item.customOutputName;
  if (!outputName && templateRegions.length > 0) {
    const textFor = (region) =>
      videoIdx >= 0 ? String(cellText?.(videoIdx, region.id) ?? "") : "";
    const firstTextRegion =
      templateRegions.find(
        (r) => String(r.label || "").toUpperCase() === "TEXT_1" && textFor(r).trim(),
      ) ||
      templateRegions.find((r) => textFor(r).trim()) ||
      templateRegions.find((r) => String(r.label || "").toUpperCase() === "TEXT_1") ||
      templateRegions[0];
    const id = videoIdx >= 0 ? stripExt(String(displayId?.(videoIdx) ?? "")) : stem;
    outputName = buildIdTextOutputName(id, textFor(firstTextRegion), exportFormat);
  }
  return outputName || `${stem}_beru.${exportFormat}`;
}

function applyCollisionSuffix(outputName, rank) {
  if (rank <= 0) return outputName;
  const stem = stripExt(outputName);
  return `${stem}__${rank + 1}${outputName.slice(stem.length)}`;
}

function joinOutputPath(outputDir, item, outputName) {
  const outDir = outputDir || item.path.replace(/[\\/][^\\/]*$/, "");
  const base = outDir.replace(/[\\/]+$/, "");
  const sep = base.includes("\\") ? "\\" : "/";
  return `${base}${sep}${outputName}`;
}

function allocateOutputNames(names) {
  const key = (name) => name.toLowerCase();
  const reserved = new Set(names.map(key));
  const used = new Set();
  const nextRank = new Map();
  return names.map((name) => {
    const baseKey = key(name);
    let rank = 0;
    let candidate = name;
    while (used.has(key(candidate)) || (rank > 0 && reserved.has(key(candidate)))) {
      rank = rank === 0 ? nextRank.get(baseKey) || 1 : rank + 1;
      candidate = applyCollisionSuffix(name, rank);
    }
    nextRank.set(baseKey, rank + 1);
    used.add(key(candidate));
    return candidate;
  });
}

export function resolveOutputNames(queue, naming) {
  return allocateOutputNames(queue.map((item, i) => desiredOutputName(item, i, naming)));
}

export function resolveOutputPaths(queue, outputDir, naming) {
  const names = resolveOutputNames(queue, naming);
  return queue.map((item, i) => joinOutputPath(outputDir, item, names[i]));
}

export function resolveDetachedOutputPath(item, queue, outputDir, naming) {
  const index = namingIndexOf(queue, item);
  const names = queue.map((q, i) => desiredOutputName(q, i, naming));
  if (index < 0) names.push(desiredOutputName(item, -1, naming));
  const allocated = allocateOutputNames(names);
  return joinOutputPath(outputDir, item, allocated[index < 0 ? names.length - 1 : index]);
}
