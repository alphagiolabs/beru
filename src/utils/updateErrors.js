/** Map updater IPC failure codes to i18n keys. */
const ERROR_KEYS = {
  "no-update-available": "updater.errors.noUpdateAvailable",
  "no-api": "updater.errors.noApi",
  "dev-build": "updater.errors.devBuild",
  "missing-module": "updater.errors.missingModule",
  "not-available": "updater.errors.notAvailable",
  "download-failed": "header.updateDownloadFailed",
  aborted: "header.updateDownloadFailed",
};

export function formatUpdateError(t, error) {
  if (!error) return null;
  const key = ERROR_KEYS[error];
  if (key) return t(key);
  if (typeof error === "string" && error.length > 0 && error.length < 200) return error;
  return t("header.updateDownloadFailed");
}
