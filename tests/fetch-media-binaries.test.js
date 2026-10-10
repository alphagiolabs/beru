import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ensureMediaBinaries } from "../scripts/fetch-ffmpeg.mjs";
import manifest from "../resources/media-binaries.json" with { type: "json" };

describe("pinned media binaries", () => {
  it("rejects a corrupt archive before replacing existing binaries", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "beru-media-integrity-"));
    try {
      const previous = path.join(directory, "ffmpeg.exe");
      const archivePath = path.join(directory, "corrupt.zip");
      await fs.writeFile(previous, "previous installation");
      await fs.writeFile(archivePath, "untrusted download");
      await expect(ensureMediaBinaries({ destination: directory, archivePath })).rejects.toThrow(
        "Archive SHA-256 mismatch",
      );
      expect(await fs.readFile(previous, "utf8")).toBe("previous installation");
      await expect(fs.access(path.join(directory, "ffprobe.exe"))).rejects.toThrow();
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it(
    "verifies the installed pair offline without reading an archive",
    { timeout: 120000 },
    async () => {
      await expect(
        ensureMediaBinaries({ archivePath: path.resolve("bin/nonexistent-archive.zip") }),
      ).resolves.toEqual({ updated: false, version: manifest.version });
    },
  );
});
