import path from "path";
import { trimOldest } from "../utils/cache-trim.js";

const ALLOWED_FILES_MAX = 2000;

export function createConsentStore({ normalizeKey }) {
  const grantedReads = new Set();
  let outputDirectory = null;
  let outputKey = null;

  function grantRead(resolvedPath) {
    grantedReads.add(normalizeKey(resolvedPath));
    trimOldest(grantedReads, ALLOWED_FILES_MAX);
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

  return { grantRead, hasReadConsent, selectOutputDirectory, getOutputDirectory };
}
