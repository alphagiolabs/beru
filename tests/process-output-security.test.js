import { describe, expect, it } from "vitest";
import path from "path";
import { deriveOutputPath } from "../main/utils/process-output.js";

describe("process output path security", () => {
  it("derives output inside the selected directory from an arbitrary absolute renderer path", () => {
    const selectedDirectory = path.resolve("C:\\Users\\tester\\Videos\\Beru");
    const rendererPath = "C:\\Windows\\System32\\payload.mp4";

    expect(deriveOutputPath(selectedDirectory, rendererPath)).toBe(
      path.join(selectedDirectory, "payload.mp4"),
    );
  });

  it("rejects traversal and unsupported output extensions", () => {
    const selectedDirectory = path.resolve("C:\\Users\\tester\\Videos\\Beru");

    expect(() => deriveOutputPath(selectedDirectory, "..\\payload.mp4")).toThrow(/traversal/i);
    expect(() => deriveOutputPath(selectedDirectory, "payload.exe")).toThrow(/extensión/i);
  });
});
