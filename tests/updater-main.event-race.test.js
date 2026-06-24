import { describe, it, expect, beforeEach } from "vitest";
import { createUpdaterHarness } from "./updater-main.harness.mjs";

describe("main/updater.js event race guard", () => {
  let harness;

  beforeEach(() => {
    harness = createUpdaterHarness();
  });

  it("does not wipe pendingVersion when update-not-available arrives after update-available", async () => {
    harness.init();

    harness.emit("update-available", {
      version: "1.6.99",
      releaseDate: "2026-06-22",
      releaseNotes: "- fix: updater race",
    });

    expect(harness.events.at(-1).type).toBe("available");
    expect(harness.events.at(-1).version).toBe("1.6.99");

    // A duplicate or stale check emits update-not-available.
    harness.emit("update-not-available", { version: "1.6.36" });

    // The renderer still shows the update as available. A user clicking
    // "Update now" calls startDownload. It must proceed directly to downloading
    // without re-checking (which would require network and could lose the update).
    const downloadPromise = harness.updater.startDownload();

    expect(harness.events.at(-1).type).toBe("downloading");
    expect(harness.events.at(-1).percent).toBe(0);

    harness.resolveDownload();
    await downloadPromise;

    harness.emit("update-downloaded", { version: "1.6.99" });
    expect(harness.events.at(-1).type).toBe("ready");
    expect(harness.events.at(-1).version).toBe("1.6.99");
  });

  it("preserves releaseNotes when re-emitting an available pending update", async () => {
    harness.init();

    harness.emit("update-available", {
      version: "1.6.99",
      releaseDate: "2026-06-22",
      releaseNotes: "- fix: release notes survival",
    });

    const checkPromise = harness.updater.checkForUpdates();
    // The pending-version guard should re-emit available without calling au.checkForUpdates.
    await checkPromise;

    const available = harness.events.filter((s) => s.type === "available");
    expect(available).toHaveLength(2);
    expect(available[1].version).toBe("1.6.99");
    expect(available[1].releaseNotes).toBe("- fix: release notes survival");
  });

  it("does not allow checkForUpdates to clobber a downloading state", async () => {
    harness.init();

    harness.emit("update-available", { version: "1.6.99" });
    const downloadPromise = harness.updater.startDownload();

    expect(harness.events.at(-1).type).toBe("downloading");

    const secondCheck = await harness.updater.checkForUpdates();
    expect(secondCheck.reason).toBe("download-in-progress");
    expect(harness.events.at(-1).type).toBe("downloading");

    harness.resolveDownload();
    await downloadPromise;
  });

  it("starts download using renderer version hint when pendingVersion was lost", async () => {
    harness.init();

    const downloadPromise = harness.updater.startDownload({ version: "1.6.99" });

    expect(harness.events.at(-1).type).toBe("downloading");
    expect(harness.events.at(-1).version).toBe("1.6.99");

    harness.resolveDownload();
    await downloadPromise;

    harness.emit("update-downloaded", { version: "1.6.99" });
    expect(harness.events.at(-1).type).toBe("ready");
  });

  it("disables Authenticode verification for unsigned NSIS builds", () => {
    harness.init();
    expect(harness.autoUpdater.verifyUpdateCodeSignature).toBeTypeOf("function");
    return expect(harness.autoUpdater.verifyUpdateCodeSignature([], "fake.exe")).resolves.toBeNull();
  });
});
