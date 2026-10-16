import { createPathResolver } from "./security/path-resolver.js";
import { createLocationPolicy } from "./security/location-policy.js";
import { createConsentStore } from "./security/consent.js";
import { createWriteCapabilities } from "./security/write-capability.js";
import { createPathVerdicts } from "./security/path-verdicts.js";
import { sweepOrphanedExports } from "./utils/process-output.js";
import { cachedProtocolStat } from "./utils/beru-protocol.js";

export function createPathSecurity(app) {
  const { resolveSafe, resolveSafeAsync, normalizeKey } = createPathResolver();
  const location = createLocationPolicy({ app, resolveSafe, resolveSafeAsync, normalizeKey });
  const consent = createConsentStore({ normalizeKey });
  const writes = createWriteCapabilities({ resolveSafe, location, normalizeKey });
  const verdicts = createPathVerdicts({
    resolveSafe,
    resolveSafeAsync,
    location,
    consent,
    protocolStat: cachedProtocolStat,
  });

  function registerAllowedPath(filePath, kind) {
    const check = verdicts.inspectReadableFile(filePath, kind);
    if (!check.ok) return check;
    consent.grantRead(check.resolvedPath, kind);
    return check;
  }

  function registerSelectedPath(filePath, kind) {
    const check = verdicts.inspectReadableFile(filePath, kind, { selectedByUser: true });
    if (check.ok) consent.grantRead(check.resolvedPath, kind);
    return check;
  }

  function registerSelectedPaths(paths, kind) {
    return paths
      .map((filePath) => registerSelectedPath(filePath, kind))
      .filter((check) => check.ok)
      .map((check) => check.resolvedPath);
  }

  function registerOutputDirectory(directoryPath) {
    const check = verdicts.inspectOutputDirectory(directoryPath);
    if (!check.ok) return check;
    consent.selectOutputDirectory(check.resolvedPath);
    sweepOrphanedExports(check.resolvedPath);
    return check;
  }

  function releaseVideoPaths(paths, retainedPaths = []) {
    const retained = new Set(retainedPaths.map(resolveSafe).filter(Boolean).map(normalizeKey));
    for (const filePath of paths) {
      const resolved = resolveSafe(filePath);
      if (resolved && !retained.has(normalizeKey(resolved))) consent.revokeRead(resolved, "video");
    }
  }

  return {
    registerAllowedPath,
    registerSelectedPath,
    registerSelectedPaths,
    releaseVideoPaths,
    registerOutputDirectory,
    getOutputDirectory: consent.getOutputDirectory,
    registerWritePath: writes.approve,
    consumeWritePath: writes.consume,
    validateReadableFile: verdicts.inspectReadableFile,
    validateReadableFileAsync: verdicts.inspectReadableFileAsync,
    validateShellPath: verdicts.inspectShellPath,
    validateProtocolFile: verdicts.inspectProtocolFile,
  };
}
