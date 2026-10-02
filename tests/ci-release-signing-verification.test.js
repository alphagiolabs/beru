import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const workflowPath = path.join(process.cwd(), ".github", "workflows", "ci-release.yml");
const src = fs.readFileSync(workflowPath, "utf-8");

describe(".github/workflows/ci-release.yml: post-build signing verification", () => {
  it("has a 'Verify installer signature' step after 'Package & publish'", () => {
    const packageIdx = src.indexOf("name: Package & publish");
    expect(packageIdx).toBeGreaterThan(-1);
    const verifyMatch = src.match(
      /- name: Verify installer signature[\s\S]*?(?=\n\s{6}- name:|\n\s*\n\s*if:|$)/,
    );
    expect(verifyMatch, "Verify installer signature step must exist").not.toBeNull();
    expect(src.indexOf("Verify installer signature")).toBeGreaterThan(packageIdx);
  });

  it("uses Get-AuthenticodeSignature to inspect the installer", () => {
    expect(src).toMatch(/Get-AuthenticodeSignature/);
    expect(src).toMatch(/Signature status/);
  });

  it("does not hard-fail when the installer is unsigned (cert secret is optional)", () => {
    expect(src).not.toMatch(/WINDOWS_CERTIFICATE_BASE64 secret is missing.*cannot sign/i);
    expect(src).toMatch(/Write-Warning.*signature is not Valid/i);
  });
});
