import path from "path";

export function createConsentStore({ normalizeKey }) {
  const grantedReads = new Map();
  let outputDirectory = null;
  let outputKey = null;

  function grantRead(resolvedPath, kind = "file") {
    grantedReads.set(normalizeKey(resolvedPath), kind);
  }

  function revokeRead(resolvedPath, kind) {
    const key = normalizeKey(resolvedPath);
    if (grantedReads.get(key) === kind) grantedReads.delete(key);
  }

  function hasReadConsent(resolvedPath) {
    const key = normalizeKey(resolvedPath);
    if (grantedReads.has(key)) return true;
    return outputKey !== null && key.startsWith(`${outputKey}${path.sep}`);
  }

  function selectOutputDirectory(resolvedPath) {
    outputDirectory = resolvedPath;
    outputKey = normalizeKey(resolvedPath);
    grantRead(resolvedPath);
  }

  function getOutputDirectory() {
    return outputDirectory;
  }

  return { grantRead, revokeRead, hasReadConsent, selectOutputDirectory, getOutputDirectory };
}
