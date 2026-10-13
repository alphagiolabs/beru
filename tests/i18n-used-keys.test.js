import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import es from "../src/i18n/messages/es.json";

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.(jsx?|mjs)$/.test(entry.name) ? [full] : [];
  });

it('defines every literal t("key") used by the renderer', () => {
  const missing = [];
  for (const file of walk("src")) {
    for (const [, key] of readFileSync(file, "utf8").matchAll(/\bt\(\s*"([\w.]+)"/g)) {
      if (!(key in es)) missing.push(`${file}: ${key}`);
    }
  }
  expect(missing).toEqual([]);
});
