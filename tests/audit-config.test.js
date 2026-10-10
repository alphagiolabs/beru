import { describe, it, expect } from "vitest";
import fs from "fs";

const pkg = JSON.parse(fs.readFileSync("package.json", "utf-8"));
const lock = JSON.parse(fs.readFileSync("package-lock.json", "utf-8"));
const changelog = fs.readFileSync("CHANGELOG.md", "utf-8");

describe("audit: project configuration", () => {
  it("package.json and package-lock.json versions match", () => {
    expect(lock.version).toBe(pkg.version);
    expect(lock.lockfileVersion).toBeGreaterThanOrEqual(3);
  });

  it("CHANGELOG has an entry for the current package version", () => {
    const header = `## [${pkg.version}]`;
    expect(changelog.includes(header)).toBe(true);
  });

  it("electron-builder output directory matches the release workflow", () => {
    expect(pkg.build.directories.output).toBe("dist-installer");
  });
});
