import React, { act } from "react";
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainSrc = readFileSync(path.join(__dirname, "..", "main", "main.js"), "utf-8");

describe("main/main.js quit handlers during update install", () => {
  it("does not intercept before-quit when quitting for an update", () => {
    expect(mainSrc).toMatch(/before-quit[\s\S]*isQuittingForUpdate\(\)\) return/);
  });

  it("does not intercept will-quit when quitting for an update", () => {
    expect(mainSrc).toMatch(/will-quit[\s\S]*isQuittingForUpdate\(\)\) return/);
  });
});
