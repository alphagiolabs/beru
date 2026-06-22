import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * Regression: when `spawn()` failed (e.g. binary missing), Node emitted both
 * `error` and `close` on the child. `onError` sent `process:error` and
 * settled the run; then `onClose` fired and unconditionally sent
 * `process:finished`, leaving the execution history in an ambiguous state.
 *
 * The fix: `onClose` must check `settled` before emitting `process:finished`
 * so a run that already reported an error doesn't also report a finish.
 */

const filePath = path.join(process.cwd(), "main", "handlers", "process.js");
const src = fs.readFileSync(filePath, "utf-8");

describe("main/handlers/process.js: no double signal on spawn error", () => {
  it("onClose checks `settled` before sending process:finished", () => {
    // Locate the onClose function body.
    const onCloseMatch = src.match(/const onClose = \(code\) => \{([\s\S]*?)\n\s{6}\};/);
    expect(onCloseMatch, "onClose function must exist").not.toBeNull();
    const body = onCloseMatch[1];

    // The `settled` guard must appear BEFORE the first sendToRenderer call.
    const settledIdx = body.indexOf("settled");
    const finishedSendIdx = body.indexOf('sendToRenderer("process:finished"');
    expect(settledIdx).toBeGreaterThanOrEqual(0);
    expect(finishedSendIdx).toBeGreaterThanOrEqual(0);
    expect(settledIdx).toBeLessThan(finishedSendIdx);
  });
});
