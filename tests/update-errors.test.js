import { describe, it, expect } from "vitest";
import { formatUpdateError } from "../src/utils/updateErrors.js";

const t = (key) => key;

describe("formatUpdateError", () => {
  it("maps known IPC failure codes to i18n keys", () => {
    expect(formatUpdateError(t, "no-update-available")).toBe("updater.errors.noUpdateAvailable");
    expect(formatUpdateError(t, "no-api")).toBe("updater.errors.noApi");
    expect(formatUpdateError(t, "dev-build")).toBe("updater.errors.devBuild");
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
