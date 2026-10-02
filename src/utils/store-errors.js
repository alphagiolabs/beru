const STORE_ERROR_KEYS = {
  api_unavailable: "errors.noApi",
  busy: "queue.processingBusy",
  already_processing: "queue.processingBusy",
  invalid_video: "errors.invalidVideo",
  no_job: "errors.noJob",
  no_jobs: "errors.noJobsToProcess",
  processing_failed: "queue.processFailed",
  cancelled: "errors.processingCancelled",
  output_dir_missing: "errors.outputDirMissing",
  not_project: "errors.notProject",
  invalid_preset: "errors.invalidPreset",
  preset_no_filename: "errors.presetNoFilename",
  empty_preset_name: "errors.emptyPresetName",
  project_missing: "header.recentMissing",
  excel_api_unavailable: "errors.excelApiUnavailable",
  excel_no_rows: "errors.excelNoRows",
  excel_write_failed: "errors.excelWriteFailed",
  excel_read_failed: "errors.excelReadFailed",
  theme_not_found: "errors.themeNotFound",
  invalid_tokens: "errors.themeInvalidTokens",
  missing_token: "errors.themeMissingToken",
  invalid_color: "errors.themeInvalidColor",
  missing: "errors.inputMissing",
  not_file: "errors.inputNotFile",
  empty: "errors.inputEmpty",
  cloud_only: "errors.inputCloudOnly",
  unreadable: "errors.inputUnreadable",
  python_missing: "errors.proc.pythonMissing",
  font_missing: "errors.proc.fontMissing",
  missing_file: "errors.proc.missingFile",
  "invalid-slug": "settings.petdex.selectFailed",
  "not-installed": "settings.petdex.selectFailed",
  "invalid-entry": "settings.petdex.installFailed",
  "api-missing": "errors.noApi",
  "already-loading": "settings.petdex.selectFailed",
  "load-failed": "settings.petdex.selectFailed",
  "fetch-failed": "settings.petdex.loadFailed",
};

export function storeErrorText(t, res, fallbackKey) {
  const codeKey = STORE_ERROR_KEYS[res?.code] ?? STORE_ERROR_KEYS[res?.error];
  if (codeKey) return t(codeKey, { token: res?.detail, ...(res?.vars || {}) });
  if (typeof res?.error === "string" && res.error) return res.error;
  return t(fallbackKey);
}
