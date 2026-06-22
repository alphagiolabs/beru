import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * Regression: the release workflow must run a post-build Authenticode
 * signature check on the installer and log the result. Originally the step
 * hard-failed when the signature was not "Valid"; that blocked releases when
 * the WINDOWS_CERTIFICATE_BASE64 secret was not provisioned. The current
 * contract is:
 *
 *   - The "Verify installer signature" step must exist and run AFTER packaging.
 *   - It must use Get-AuthenticodeSignature to inspect the .exe.
 *   - It must report the signature status (Valid / NotSigned / etc.).
 *   - It must NOT hard-fail the build when the installer is unsigned — that
 *     permits shipping while the cert is being provisioned. Add the cert
 *     secret to enable strict signing enforcement.
 */

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
    // The step must report the signature status to the workflow log.
    expect(src).toMatch(/Signature status/);
  });

  it("does not hard-fail when the installer is unsigned (cert secret is optional)", () => {
    // The pre-existing "Verify signing secrets" gate was removed so the
    // pipeline can publish without a cert. The post-build step must warn,
    // not error, when the signature is not Valid.
    expect(src).not.toMatch(/WINDOWS_CERTIFICATE_BASE64 secret is missing.*cannot sign/i);
    expect(src).toMatch(/Write-Warning.*signature is not Valid/i);
  });
});
