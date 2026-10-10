export function beruLocalUrl(filePath, version) {
  const url = `beru://local/${encodeURIComponent(filePath)}`;
  return version ? `${url}?v=${encodeURIComponent(version)}` : url;
}

export function imageVersion(stat) {
  return `${stat.mtimeMs}-${stat.size}`;
}
