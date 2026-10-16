import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { load } = require("js-yaml");
const workflow = load(readFileSync(".github/workflows/ci-release.yml", "utf8"));

describe("release prerequisites", () => {
  it.each([
    ["test", "python/requirements-test.txt"],
    ["release", "python/requirements-build.txt"],
  ])("caches pinned Python downloads in the %s job", (job, requirements) => {
    const setup = workflow.jobs[job].steps.find((step) =>
      step.uses?.startsWith("actions/setup-python@"),
    );
    expect(setup.with["python-version-file"]).toBe(".python-version");
    expect(setup.with.cache).toBe("pip");
    expect(setup.with["cache-dependency-path"].trim().split(/\s+/).sort()).toEqual(
      ["python/requirements.txt", requirements].sort(),
    );
  });

  it.each(["test", "release"])("restores pinned media before npm ci in the %s job", (job) => {
    const steps = workflow.jobs[job].steps;
    const cached = steps.findIndex((step) => step.uses?.startsWith("actions/cache@"));
    const install = steps.findIndex((step) => /npm ci/.test(step.run || ""));
    expect(cached).toBeGreaterThan(-1);
    expect(cached).toBeLessThan(install);
    expect(steps[cached].with.key).toContain("${{ runner.os }}");
    expect(steps[cached].with.key).toContain("hashFiles('resources/media-binaries.json')");
    const manifest = JSON.parse(readFileSync("resources/media-binaries.json", "utf8"));
    expect(new Set(steps[cached].with.path.trim().split(/\s+/))).toEqual(
      new Set(manifest.files.map((file) => `bin/${file.target}`)),
    );
  });

  it("installs pinned Python test requirements before verification", () => {
    const steps = workflow.jobs.test.steps;
    const install = steps.findIndex((step) =>
      /pip install.*-r python\/requirements-test\.txt/.test(step.run || ""),
    );
    const tests = steps.findIndex((step) => /npm run (verify|test:python)/.test(step.run || ""));
    expect(install).toBeGreaterThan(-1);
    expect(install).toBeLessThan(tests);
  });

  it("builds the release after verification without repeating the Python suite", () => {
    const release = workflow.jobs.release;
    expect([release.needs].flat()).toContain("test");
    const steps = release.steps;
    expect(steps.some((step) => /npm run (verify|test:python)/.test(step.run || ""))).toBe(false);
    expect(steps.some((step) => /pip install.*requirements-test\.txt/.test(step.run || ""))).toBe(
      false,
    );
    const processor = steps.findIndex((step) => /npm run build:processor/.test(step.run || ""));
    const packaging = steps.findIndex((step) => /electron-builder/.test(step.run || ""));
    expect(processor).toBeGreaterThan(-1);
    expect(processor).toBeLessThan(packaging);
    expect(steps[processor]["continue-on-error"]).not.toBe(true);
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
