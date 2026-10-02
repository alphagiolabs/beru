#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const GATES = [
  { name: "lint", args: ["node_modules/eslint/bin/eslint.js", ".", "--quiet"] },
  { name: "format", args: ["node_modules/prettier/bin/prettier.cjs", "--check", "."] },
  { name: "test", args: ["node_modules/vitest/vitest.mjs", "run"] },
  { name: "python", npm: "test:python" },
];

const RED = "[31m";
const GREEN = "[32m";
const DIM = "[2m";
const RESET = "[0m";

let failed = false;

for (const gate of GATES) {
  process.stdout.write(`\n${DIM}--- ${gate.name} ---${RESET}\n`);

  const result = gate.npm
    ? spawnSync("npm", ["run", gate.npm], { cwd: ROOT, stdio: "inherit", shell: true })
    : spawnSync(process.execPath, gate.args, { cwd: ROOT, stdio: "inherit" });

  if (result.error) {
    console.error(`${RED}${gate.name} could not start:${RESET} ${result.error.message}`);
    failed = true;
  } else if (result.status !== 0) {
    console.error(`${RED}${gate.name} failed (exit ${result.status})${RESET}`);
    failed = true;
  }
}

if (failed) {
  console.error(`\n${RED}verify: FAILED${RESET}`);
  process.exit(1);
}
console.log(`\n${GREEN}verify: all gates passed${RESET}`);
