import { describe, it, expect } from "vitest";
import { IDLE_UPDATE, reduceUpdaterEvent, canStartDownload } from "../src/utils/updateState.js";

describe("reduceUpdaterEvent", () => {
  it("preserves release metadata while download progress arrives", () => {
    const available = reduceUpdaterEvent(IDLE_UPDATE, {
      type: "available",
      version: "1.6.0",
      releaseUrl: "https://github.com/alphagiolabs/beru/releases/tag/v1.6.0",
      releaseNotes: "Cambios de prueba",
    });

    const downloading = reduceUpdaterEvent(available, {
      type: "downloading",
      percent: 42.4,
      transferred: 4200,
      total: 10000,
    });

    expect(downloading).toEqual(
      expect.objectContaining({
        status: "downloading",
        version: "1.6.0",
        percent: 42.4,
        releaseNotes: "Cambios de prueba",
        releaseUrl: "https://github.com/alphagiolabs/beru/releases/tag/v1.6.0",
      }),
    );
  });

  it("does not clobber an active download when a new check starts", () => {
    const downloading = {
      ...IDLE_UPDATE,
      status: "downloading",
      version: "1.6.0",
      percent: 55,
    };

    expect(reduceUpdaterEvent(downloading, { type: "checking" })).toBe(downloading);
    expect(reduceUpdaterEvent(downloading, { type: "not-available" })).toBe(downloading);
  });

  it("returns to available after a download error so the user can retry", () => {
    const downloading = {
      ...IDLE_UPDATE,
      status: "downloading",
      version: "1.6.0",
      percent: 12,
      transferred: 1200,
      total: 10000,
      releaseUrl: "https://github.com/alphagiolabs/beru/releases/tag/v1.6.0",
    };

    expect(reduceUpdaterEvent(downloading, { type: "error", message: "network" })).toEqual(
      expect.objectContaining({
        status: "available",
        version: "1.6.0",
        percent: 0,
        transferred: 0,
        total: 0,
        error: "network",
      }),
    );
  });

  it("keeps an available update visible when a duplicate error arrives", () => {
    const available = {
      ...IDLE_UPDATE,
      status: "available",
      version: "1.6.0",
      releaseUrl: "https://github.com/alphagiolabs/beru/releases/tag/v1.6.0",
    };

    expect(reduceUpdaterEvent(available, { type: "error", message: "network" })).toBe(available);
  });

  it("keeps silent failures for background checks", () => {
    expect(reduceUpdaterEvent(IDLE_UPDATE, { type: "error", message: "aborted" })).toEqual(
      IDLE_UPDATE,
    );
  });
});

describe("update flow helpers", () => {
  it("detects when a download can start", () => {
    expect(canStartDownload({ status: "available", version: "1.6.0" })).toBe(true);
    expect(canStartDownload({ status: "downloading", version: "1.6.0" })).toBe(false);
  });
});
