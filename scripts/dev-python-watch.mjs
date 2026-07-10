/**
 * Decide whether a python/ filesystem event should restart Electron in
 * `scripts/dev.mjs`. Only runtime processor modules matter — tests, scratch
 * scripts, and build helpers must not bounce the app window.
 */

const RUNTIME_PROCESSOR_MODULES = new Set([
  "processor.py",
  "batch_errors.py",
  "color_validation.py",
  "delogo_chains.py",
  "encode_profiles.py",
  "op_shared.py",
  "text_layout_helpers.py",
]);

export function shouldRestartElectronForPythonChange(filename) {
  if (!filename || typeof filename !== "string") return false;
  const base = filename.split(/[/\\]/).pop();
  return RUNTIME_PROCESSOR_MODULES.has(base);
}
