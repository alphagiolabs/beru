import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const src = fs.readFileSync(path.join(process.cwd(), "src/components/Header.jsx"), "utf-8");

describe("handleProcessAll reentrancy guard", () => {
  it("claims isProcessing before awaiting refreshMissingVideoInfo", () => {
    const fnStart = src.indexOf("const handleProcessAll = async");
    const fnBody = src.slice(fnStart, src.indexOf("const handleTestCurrent"));
    const claimIdx = fnBody.search(/isProcessing:\s*true/);
    const awaitIdx = fnBody.indexOf("refreshMissingVideoInfo");
    expect(claimIdx).toBeGreaterThanOrEqual(0);
    expect(awaitIdx).toBeGreaterThan(claimIdx);
  });

  it("ignores cancelled pre-spawn results without error toast", () => {
    const fnBody = src.slice(
      src.indexOf("const handleProcessAll = async"),
      src.indexOf("const handleTestCurrent"),
    );
    expect(fnBody).toMatch(/result\?\.cancelled|result\.cancelled/);
    // cancelled path must not use processStartFailed for that branch first
    const cancelledIdx = fnBody.search(/cancelled/);
    const toastFailIdx = fnBody.indexOf("processStartFailed");
    expect(cancelledIdx).toBeGreaterThanOrEqual(0);
    expect(toastFailIdx).toBeGreaterThan(cancelledIdx);
  });
});
