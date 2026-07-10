import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * Closing the window mid-batch must confirm with the user before cancelling.
 */

const windowSrc = fs.readFileSync(path.join(process.cwd(), "main", "utils", "window.js"), "utf-8");

describe("main/utils/window.js close confirmation during processing", () => {
  it("intercepts close when hasActiveProcessing", () => {
    expect(windowSrc).toMatch(/win\.on\("close"/);
    expect(windowSrc).toMatch(/hasActiveProcessing\(\)/);
    expect(windowSrc).toMatch(/showMessageBox/);
    expect(windowSrc).toMatch(/cancelActiveProcessing/);
    expect(windowSrc).toMatch(/Cancelar y salir/);
  });

  it("skips confirm when quitting for an update", () => {
    expect(windowSrc).toMatch(/isQuittingForUpdate\(\)/);
  });
});
