import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const src = fs.readFileSync(
  path.join(process.cwd(), "src/components/video-preview/WatermarkOverlay.jsx"),
  "utf-8",
);

function watermarkPreviewBody(maxLen) {
  const wmStart = src.indexOf("video.offsetWidth");
  expect(wmStart).toBeGreaterThan(-1);
  return src.slice(wmStart, wmStart + maxLen);
}

describe("watermark preview zoom contract", () => {
  it("sizes watermark from offsetWidth/Height not getBoundingClientRect", () => {
    const wmBody = watermarkPreviewBody(2500);
    expect(wmBody).toMatch(/video\.offsetWidth/);
    expect(wmBody).toMatch(/video\.offsetHeight/);
    expect(wmBody).not.toMatch(/\.getBoundingClientRect\s*\(/);
  });

  it("keeps bottom watermark margin parity with FFmpeg (no +60 preview offset)", () => {
    const wmBody = watermarkPreviewBody(3500);
    expect(wmBody).toMatch(/"bottom-right":\s*\{\s*right:\s*margin,\s*bottom:\s*margin\s*\}/);
    expect(wmBody).not.toMatch(/bottom:\s*margin\s*\+\s*60/);
  });
});
