import { createPathResolver } from "./security/path-resolver.js";
import { createLocationPolicy } from "./security/location-policy.js";
import { createConsentStore } from "./security/consent.js";
import { createWriteCapabilities } from "./security/write-capability.js";
import { createPathVerdicts } from "./security/path-verdicts.js";

/** @typedef {'excel' | 'image' | 'video' | 'project'} ReadKind */

export function createPathSecurity(app) {
  const { resolveSafe, normalizeKey } = createPathResolver();
  const location = createLocationPolicy({ app, resolveSafe, normalizeKey });
  const consent = createConsentStore({ normalizeKey });
  const writes = createWriteCapabilities({ resolveSafe, location, normalizeKey });
  const verdicts = createPathVerdicts({ resolveSafe, location, consent });

  /**
   * @param {string} filePath
   * @param {ReadKind} kind
   * @returns {{ ok: true, resolvedPath: string } | { ok: false, error: string }}
   */
  function registerAllowedPath(filePath, kind) {
    const check = verdicts.inspectReadableFile(filePath, kind);
    if (!check.ok) return check;
    consent.grantRead(check.resolvedPath);
    return check;
  }

  function registerAllowedPaths(paths, kind) {
    if (!Array.isArray(paths)) return;
    for (const p of paths) registerAllowedPath(p, kind);
  }

  function registerSelectedPath(filePath, kind) {
    const check = verdicts.inspectReadableFile(filePath, kind, { selectedByUser: true });
    if (check.ok) consent.grantRead(check.resolvedPath);
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
    return check;
  }

  return {
    registerAllowedPath,
    registerAllowedPaths,
    registerSelectedPath,
    registerSelectedPaths,
    registerOutputDirectory,
    getOutputDirectory: consent.getOutputDirectory,
    registerWritePath: writes.approve,
    consumeWritePath: writes.consume,
    validateReadableFile: verdicts.inspectReadableFile,
    validateShellPath: verdicts.inspectShellPath,
    validateProtocolFile: verdicts.inspectProtocolFile,
  };
}
