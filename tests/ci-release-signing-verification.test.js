import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { load } = require("js-yaml");
const workflow = load(readFileSync(".github/workflows/ci-release.yml", "utf8"));

describe("release prerequisites", () => {
  it.each(["test", "release"])("installs pinned Python test requirements in the %s job", (job) => {
    const steps = workflow.jobs[job].steps;
    const install = steps.findIndex((step) =>
      /pip install.*-r python\/requirements-test\.txt/.test(step.run || ""),
    );
    const tests = steps.findIndex((step) => /npm run (verify|test:python)/.test(step.run || ""));
    expect(install).toBeGreaterThan(-1);
    expect(install).toBeLessThan(tests);
  });

  it("packages without publishing and verifies signatures before any upload", () => {
    const steps = workflow.jobs.release.steps;
    const packageStep = steps.findIndex((step) => /electron-builder/.test(step.run || ""));
    const verify = steps.findIndex((step) =>
      /verify-installer-signature\.ps1/.test(step.run || ""),
    );
    const publish = steps.findIndex((step) => /gh release upload/.test(step.run || ""));
    expect(steps[packageStep].run).toContain("--publish never");
    expect(verify).toBeGreaterThan(packageStep);
    expect(publish).toBeGreaterThan(verify);
    expect(steps[verify]["continue-on-error"]).not.toBe(true);
  });

  it("publishes only a verified draft and never replaces published installers", () => {
    const steps = workflow.jobs.release.steps;
    const upload = steps.find((step) => /gh release upload/.test(step.run || "")).run;
    expect(upload).toContain("--draft --title");
    expect(upload).toContain("Refusing to overwrite a published release");
    expect(upload.indexOf("gh release download")).toBeGreaterThan(
      upload.indexOf("gh release upload"),
    );
    expect(upload.indexOf("--assets-only")).toBeLessThan(upload.indexOf("--draft=false"));
    expect(
      steps.some((step) =>
        /release-metadata\.mjs --tag.*--dist dist-installer/.test(step.run || ""),
      ),
    ).toBe(true);
  });
});
