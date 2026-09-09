export function beruLocalUrl(filePath) {
  if (!filePath) return null;
  return `beru://local/${encodeURIComponent(filePath)}`;
}
