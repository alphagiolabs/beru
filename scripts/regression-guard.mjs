#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SCRIPT = resolve(__dirname, "regression-guard.sh");

function findBash() {
  const candidates = [
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
    "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return "bash";
}

if (!existsSync(SCRIPT)) {
  console.error("[regression-guard] regression-guard.sh not found");
  process.exit(1);
}

const args = process.argv.slice(2);
const bashBin = findBash();

try {
  execFileSync(bashBin, [SCRIPT, ...args], {
    cwd: ROOT,
    stdio: "inherit",
    timeout: 300_000,
  });
} catch (e) {
  process.exit(e.status ?? 1);
}
