import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { getConfig } = require("app-builder-lib/out/util/config/config.js");
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const configPath = pkg.scripts.build.match(/--config\s+(\S+)/)?.[1];

afterEach(() => vi.unstubAllEnvs());

describe("signing distribution modes", () => {
  it("requires signatures and updater verification when a certificate is configured", async () => {
    vi.stubEnv("BERU_SIGNING_MODE", "signed");
    vi.stubEnv("CSC_LINK", "certificate.pfx");
    vi.stubEnv("WIN_CSC_LINK", "");
    const config = await getConfig(process.cwd(), configPath);
    expect(config.forceCodeSigning).toBe(true);
    expect(config.win.verifyUpdateCodeSignature).toBe(true);
  });

  it("rejects signed builds without a certificate instead of falling back to unsigned", async () => {
    vi.stubEnv("BERU_SIGNING_MODE", "signed");
    vi.stubEnv("CSC_LINK", "");
    vi.stubEnv("WIN_CSC_LINK", "");
    await expect(getConfig(process.cwd(), configPath)).rejects.toThrow(/certificate/i);
  });

  it("keeps unsigned builds available without enabling signature verification", async () => {
    vi.stubEnv("BERU_SIGNING_MODE", "unsigned");
    vi.stubEnv("CSC_LINK", "");
    vi.stubEnv("WIN_CSC_LINK", "");
    const config = await getConfig(process.cwd(), configPath);
    expect(config.win.verifyUpdateCodeSignature).toBe(false);
  });
});
