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

    harness.emit("update-not-available", { version: "1.6.36" });

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

  it("rechecks the provider rather than trusting a renderer version hint", async () => {
    harness.init();
    harness.resolveCheck({ updateInfo: { version: "1.6.36" } });
    await new Promise((resolve) => setImmediate(resolve));

    const downloadPromise = harness.updater.startDownload({ version: "1.6.99" });
    harness.emit("update-not-available", { version: "1.6.36" });
    harness.resolveCheck({ updateInfo: { version: "1.6.36" } });
    expect(harness.events.some((event) => event.type === "downloading")).toBe(false);
    expect(await downloadPromise).toMatchObject({ ok: false, error: "no-update-available" });
    expect(harness.events.some((event) => event.type === "downloading")).toBe(false);
  });

  it("retains release notes in a ready snapshot after renderer recreation", async () => {
    harness.init();
    harness.emit("update-available", {
      version: "1.6.99",
      releaseNotes: "Fixed\n- Preserve notes",
    });
    const downloading = harness.updater.startDownload();
    harness.emit("download-progress", { percent: 45, transferred: 450, total: 1000 });
    harness.emit("update-downloaded", { version: "1.6.99" });
    harness.resolveDownload();
    await downloading;
    expect(harness.updater.getSnapshot()).toMatchObject({
      type: "ready",
      releaseNotes: "Fixed\n- Preserve notes",
    });
  });

  it("preserves Authenticode rejection from electron-updater", () => {
    harness.init();
    expect(harness.autoUpdater.verifyUpdateCodeSignature).toBeTypeOf("function");
    return expect(harness.autoUpdater.verifyUpdateCodeSignature([], "fake.exe")).resolves.toBe(
      "invalid signature",
    );
  });
});
