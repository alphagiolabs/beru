import { describe, expect, it } from "vitest";
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const PYTHON = process.platform === "win32" ? "python" : "python3";
const PYTHON_PREFIX = "import sys; sys.path.insert(0, 'python'); import processor; ";

function runPython(code, args = []) {
  return spawnSync(PYTHON, ["-c", PYTHON_PREFIX + code, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 10000,
  });
}

describe("FFmpeg security validation", () => {
  it("rejects media path traversal outside the allowed root", () => {
    const allowedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "beru-media-root-"));
    const traversalPath = path.join(allowedRoot, "..", "outside.mp4");

    try {
      const result = runPython(
        [
          "root, candidate = sys.argv[1:3]",
          "try:",
          "    processor.validate_media_path(candidate, root, {'.mp4'})",
          "except ValueError:",
          "    print('rejected')",
          "else:",
          "    print('accepted')",
        ].join("\n"),
        [allowedRoot, traversalPath],
      );

      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout.trim()).toBe("rejected");
    } finally {
      fs.rmSync(allowedRoot, { recursive: true, force: true });
    }
  });

  it("rejects drawtext filter injection characters", () => {
    const result = runPython(
      [
        "op = {'text': \"safe'];movie=/tmp/payload[out]\", 'font_color': 'white', 'region': {'x': 0, 'y': 0, 'w': 400, 'h': 100}}",
        "try:",
        "    processor.build_drawtext(op)",
        "except ValueError:",
        "    print('rejected')",
        "else:",
        "    print('accepted')",
      ].join("\n"),
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe("rejected");
  });

  it("rejects injected font and border colors", () => {
    const result = runPython(
      [
        "base = {'text': 'Safe text', 'region': {'x': 0, 'y': 0, 'w': 400, 'h': 100}, 'border_width': 2}",
        "results = []",
        "for field in ('font_color', 'border_color'):",
        "    op = dict(base)",
        "    op[field] = 'white:shadowx=999'",
        "    try:",
        "        processor.build_drawtext(op)",
        "    except ValueError:",
        "        results.append('rejected')",
        "    else:",
        "        results.append('accepted')",
        "print(','.join(results))",
      ].join("\n"),
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe("rejected,rejected");
  });

  it("normalizes valid rgba colors without FFmpeg separator characters", () => {
    const result = runPython(
      [
        "value = processor.build_drawtext({'text': 'Safe text', 'font_color': 'rgba(255, 0, 0, 0.5)', 'region': {'x': 0, 'y': 0, 'w': 400, 'h': 100}})",
        "print(value)",
      ].join("\n"),
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("fontcolor=#ff000080");
    expect(result.stdout).not.toContain("rgba(");
  });

  it("applies drawtext validation to text watermarks", () => {
    const result = runPython(
      [
        "values = [",
        "    {'enabled': True, 'type': 'text', 'text': \"safe'];movie=x[out]\", 'fontColor': 'white'},",
        "    {'enabled': True, 'type': 'text', 'text': 'Safe text', 'fontColor': 'white:shadowx=999'},",
        "]",
        "results = []",
        "for value in values:",
        "    try:",
        "        processor._build_watermark_filter(value, 1920, 1080)",
        "    except ValueError:",
        "        results.append('rejected')",
        "    else:",
        "        results.append('accepted')",
        "print(','.join(results))",
      ].join("\n"),
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe("rejected,rejected");
  });
});
