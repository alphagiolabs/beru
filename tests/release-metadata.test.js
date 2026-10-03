import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { validateReleaseSource, validateReleaseArtifacts } from "../scripts/release-metadata.mjs";

describe("release source and installer contract", () => {
  let directory;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "beru-release-contract-"));
    writeFileSync(join(directory, "package.json"), JSON.stringify({ version: "1.6.47" }));
    writeFileSync(
      join(directory, "package-lock.json"),
      JSON.stringify({ version: "1.6.47", packages: { "": { version: "1.6.47" } } }),
    );
    writeFileSync(
      join(directory, "CHANGELOG.md"),
      "## [1.6.47] - 2026-10-02\n\n### Fixed\n\n- Update recovery\n\n## [1.6.46] - 2026-07-13\n\n### Fixed\n\n- Old notes\n",
    );
  });
  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  it("extracts only the candidate notes and rejects a tag or lockfile for another version", () => {
    expect(validateReleaseSource(directory, "v1.6.47").notes).toBe(
      "### Fixed\n\n- Update recovery",
    );
    expect(() => validateReleaseSource(directory, "v1.6.46")).toThrow(/Tag/);
    writeFileSync(join(directory, "package-lock.json"), JSON.stringify({ version: "1.6.46" }));
    expect(() => validateReleaseSource(directory, "v1.6.47")).toThrow(/versions differ/);
  });

  it.each(["2026-02-30", "2026-10-02 duplicate"])("rejects invalid dated notes: %s", (date) => {
    writeFileSync(
      join(directory, "CHANGELOG.md"),
      `## [1.6.47] - ${date}\n\n### Fixed\n\n- Recovery\n`,
    );
    expect(() => validateReleaseSource(directory)).toThrow();
  });

  it("rejects a corrupted installer and a missing blockmap before publishing", async () => {
    const name = "Beru-Setup-1.6.47.exe";
    const bytes = Buffer.from("independent installer fixture");
    const hash = createHash("sha512").update(bytes).digest("base64");
    const manifest = {
      version: "1.6.47",
      path: name,
      sha512: hash,
      files: [{ url: name, sha512: hash, size: bytes.length }],
    };
    writeFileSync(join(directory, "latest.yml"), JSON.stringify(manifest));
    writeFileSync(join(directory, name), bytes);
    await expect(validateReleaseArtifacts(directory, "1.6.47")).rejects.toThrow();
    writeFileSync(
      join(directory, `${name}.blockmap`),
      gzipSync(
        JSON.stringify({
          version: "2",
          files: [{ name: "file", offset: 0, sizes: [bytes.length], checksums: ["fixture"] }],
        }),
      ),
    );
    expect(await validateReleaseArtifacts(directory, "1.6.47")).toHaveLength(3);
    writeFileSync(join(directory, name), Buffer.from("same size, corrupted bytes!!"));
    await expect(validateReleaseArtifacts(directory, "1.6.47")).rejects.toThrow(/SHA512/);
    writeFileSync(join(directory, name), bytes);
    const metadata = JSON.parse(readFileSync(join(directory, "latest.yml"), "utf8"));
    metadata.version = "1.6.46";
    writeFileSync(join(directory, "latest.yml"), JSON.stringify(metadata));
    await expect(validateReleaseArtifacts(directory, "1.6.47")).rejects.toThrow(/version/);
  });
});
