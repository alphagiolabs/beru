/** @param {string | null | undefined} filePath */
export function beruLocalUrl(filePath) {
  if (!filePath) return null;
  return `beru://local/${encodeURIComponent(filePath)}`;
}
