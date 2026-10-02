export function createWriteCapabilities({ resolveSafe, location, normalizeKey }) {
  const approvedWritePaths = new Set();

  function approve(filePath) {
    const resolved = resolveSafe(filePath);
    if (!resolved || location.isDenied(resolved)) return { ok: false };
    approvedWritePaths.add(normalizeKey(resolved));
    return { ok: true };
  }

  function consume(filePath) {
    const resolved = resolveSafe(filePath);
    if (!resolved) return null;
    if (!approvedWritePaths.delete(normalizeKey(resolved))) return null;
    return resolved;
  }

  return { approve, consume };
}
