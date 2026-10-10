import { describe, expect, it } from "vitest";
import { createUpdaterHarness } from "./updater-main.harness.mjs";

describe("updater install authorization", () => {
  it("keeps automatic install disabled after a download until the user requests install", async () => {
    const harness = createUpdaterHarness();
    harness.init();
    harness.emit("update-available", { version: "1.6.99" });
    const downloading = harness.updater.startDownload();
    harness.resolveDownload();
    await downloading;
    harness.emit("update-downloaded", { version: "1.6.99" });

    expect(harness.events.at(-1)).toMatchObject({ type: "ready", version: "1.6.99" });
    expect(harness.autoUpdater.autoDownload).toBe(false);
    expect(harness.autoUpdater.autoInstallOnAppQuit).toBe(false);
    expect(harness.autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  });
});
