import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const filePath = path.join(process.cwd(), "main", "handlers", "process.js");
const src = fs.readFileSync(filePath, "utf-8");

describe("main/handlers/process.js: no double signal on spawn error", () => {
  it("onClose checks `settled` before sending process:finished", () => {
    const onCloseMatch = src.match(/const onClose = \(code\) => \{([\s\S]*?)\n\s{6}\};/);
    expect(onCloseMatch, "onClose function must exist").not.toBeNull();
    const body = onCloseMatch[1];

    const settledIdx = body.indexOf("settled");
    const finishedSendIdx = body.indexOf('sendToRenderer("process:finished"');
    expect(settledIdx).toBeGreaterThanOrEqual(0);
    expect(finishedSendIdx).toBeGreaterThanOrEqual(0);
    expect(settledIdx).toBeLessThan(finishedSendIdx);
  });
});
