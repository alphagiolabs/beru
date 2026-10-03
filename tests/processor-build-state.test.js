import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isProcessorCurrent,
  processorBuildFingerprint,
  writeProcessorReceipt,
} from "../scripts/processor-build-state.mjs";

describe("processor build reuse", () => {
  let directory;
  let executable;
  let source;
  let receipt;
  let fingerprint;
  const toolchain = { python: "3.12.10", packages: { pyinstaller: "6.22.3", numpy: "2.4.1" } };

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "beru-build-state-"));
    executable = join(directory, "processor.exe");
    source = join(directory, "processor.py");
    receipt = join(directory, "receipt.json");
    writeFileSync(source, "import numpy\n");
    writeFileSync(executable, "built processor");
    fingerprint = processorBuildFingerprint([source], toolchain);
    writeProcessorReceipt(executable, receipt, fingerprint, toolchain);
  });

  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  it("reuses a matching build but rejects changed source with its original timestamp", () => {
    expect(isProcessorCurrent(executable, receipt, fingerprint)).toBe(true);
    const { atime, mtime } = statSync(source);
    writeFileSync(source, "import numpy, temporal_motion\n");
    utimesSync(source, atime, mtime);
    const changed = processorBuildFingerprint([source], toolchain);
    expect(isProcessorCurrent(executable, receipt, changed)).toBe(false);
  });

  it.each([
    { ...toolchain, python: "3.14.2" },
    { ...toolchain, packages: { ...toolchain.packages, pyinstaller: "6.21.0" } },
    { ...toolchain, packages: { ...toolchain.packages, numpy: "2.4.6" } },
  ])("rejects reuse after a toolchain change: %j", (changedToolchain) => {
    const changed = processorBuildFingerprint([source], changedToolchain);
    expect(isProcessorCurrent(executable, receipt, changed)).toBe(false);
  });

  it("rejects a replaced executable even when the source and toolchain still match", () => {
    writeFileSync(executable, "stale processor");
    expect(isProcessorCurrent(executable, receipt, fingerprint)).toBe(false);
  });

  it("rebuilds when provenance is missing or unreadable", () => {
    rmSync(receipt);
    expect(isProcessorCurrent(executable, receipt, fingerprint)).toBe(false);
    writeFileSync(receipt, "incomplete receipt");
    expect(isProcessorCurrent(executable, receipt, fingerprint)).toBe(false);
  });
});
