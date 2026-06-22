import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * Regression: the release workflow published the installer without verifying
 * the .exe was actually signed. A misconfigured CSC_LINK or an empty secret
 * could produce an unsigned installer that ships to users.
 *
 * The fix adds a post-build step that runs `Get-AuthenticodeSignature` on the
 * .exe and fails the workflow if the signature status is not "Valid".
 */

const workflowPath = path.join(process.cwd(), ".github", "workflows", "ci-release.yml");
const src = fs.readFileSync(workflowPath, "utf-8");

describe(".github/workflows/ci-release.yml: post-build signing verification", () => {
  it("has a step that verifies the installer signature after packaging", () => {
    // Locate the "Package & publish" step and the verification step.
    const packageIdx = src.indexOf("name: Package & publish");
    expect(packageIdx).toBeGreaterThan(-1);
    // The verification step must come AFTER the package step.
    const verifyMatch = src.match(
      /- name: Verify installer signature[\s\S]*?(?=\n\s{6}- name:|\n\s*\n\s*if:|$)/,
    );
    expect(verifyMatch, "Verify installer signature step must exist").not.toBeNull();
    expect(src.indexOf("Verify installer signature")).toBeGreaterThan(packageIdx);
  });

  it("uses Get-AuthenticodeSignature to check the signature status", () => {
    expect(src).toMatch(/Get-AuthenticodeSignature/);
    // And it must fail when the status is not "Valid".
    expect(src).toMatch(/Status.*-ne.*Valid/i);
    expect(src).toMatch(/Write-Error.*signature/i);
  });
});
