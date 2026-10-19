import { describe, it, expect } from "vitest";
import es from "../src/i18n/messages/es.json";
import en from "../src/i18n/messages/en.json";
import { formatUpdateError } from "../src/utils/updateErrors.js";

const t = (key) => {
  expect(Object.hasOwn(es, key), `missing es translation: ${key}`).toBe(true);
  expect(Object.hasOwn(en, key), `missing en translation: ${key}`).toBe(true);
  return key;
};

describe("formatUpdateError", () => {
  it("maps known IPC failure codes to i18n keys", () => {
    expect(formatUpdateError(t, "no-update-available")).toBe("updater.errors.noUpdateAvailable");
    expect(formatUpdateError(t, "no-api")).toBe("updater.errors.noApi");
    expect(formatUpdateError(t, "dev-build")).toBe("updater.errors.devBuild");
    expect(formatUpdateError(t, "ERR_CHECKSUM_MISMATCH")).toBe("updater.errors.checksumMismatch");
  });

  it("falls back to generic message for unknown errors", () => {
    expect(formatUpdateError(t, null)).toBeNull();
    expect(formatUpdateError(t, "something weird")).toBe("something weird");
    expect(formatUpdateError(t, "x".repeat(250))).toBe("header.updateDownloadFailed");
  });

  it("maps invalid signature updater errors", () => {
    expect(formatUpdateError(t, "ERR_UPDATER_INVALID_SIGNATURE: not signed")).toBe(
      "updater.errors.invalidSignature",
    );
  });
});
