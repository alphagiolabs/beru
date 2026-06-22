import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * Regression: `createPreviewProxy` checked the `pending` dedup map AFTER two
 * awaits (`fs.promises.stat` and `fs.promises.mkdir`). Two concurrent calls
 * for the same file would both pass the awaits before either registered a
 * pending job, spawning two ffmpeg processes that race for the same tmpPath
 * and corrupt the cache.
 *
 * This test asserts the dedup check happens BEFORE the first await, so the
 * second concurrent caller joins the first job instead of starting its own.
 */

const filePath = path.join(process.cwd(), "main", "utils", "preview-proxy.js");
const src = fs.readFileSync(filePath, "utf-8");

describe("main/utils/preview-proxy.js: createPreviewProxy dedup race", () => {
  it("checks the pending map before any await", () => {
    // Locate the createPreviewProxy function body.
    const fnMatch = src.match(
      /export async function createPreviewProxy\(filePath\) \{([\s\S]*?)\n\}/,
    );
    expect(fnMatch, "createPreviewProxy function must exist").not.toBeNull();
    const body = fnMatch[1];

    // The first await must come AFTER a `pending.has(...)` check.
    const firstAwaitIdx = body.indexOf("await ");
    expect(firstAwaitIdx).toBeGreaterThan(-1);

    const firstPendingCheckIdx = body.indexOf("pending.has(");
    expect(firstPendingCheckIdx).toBeGreaterThanOrEqual(0);
    expect(firstPendingCheckIdx).toBeLessThan(firstAwaitIdx);
  });

  it("re-checks the pending map after the awaits to close the race window", () => {
    const fnMatch = src.match(
      /export async function createPreviewProxy\(filePath\) \{([\s\S]*?)\n\}/,
    );
    const body = fnMatch ? fnMatch[1] : "";

    // Count `pending.has(` occurrences in the body. The fix requires at least
    // two: one before the awaits (fast path) and one after (to catch a
    // parallel call that registered while we were awaiting).
    const matches = body.match(/pending\.has\(/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("uses a stable key (filePath) for the pending map, not outputPath", () => {
    // Using `outputPath` as the key would require computing it (which needs
    // `stat`) before the first check — defeating the pre-await fast path.
    // The fix keys by `filePath` so the check can happen before any await.
    const fnMatch = src.match(
      /export async function createPreviewProxy\(filePath\) \{([\s\S]*?)\n\}/,
    );
    const body = fnMatch ? fnMatch[1] : "";
    expect(body).toMatch(/pending\.has\(filePath\)/);
    expect(body).toMatch(/pending\.set\(filePath,/);
    expect(body).toMatch(/pending\.delete\(filePath\)/);
  });
});
