#!/usr/bin/env node
import { requireWindows } from "../shared/platform.js";

import { existsSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

requireWindows();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PYTHON_DIR = path.join(ROOT, "python");

const environmentPython = path.join(ROOT, ".venv-processor", "Scripts", "python.exe");
const PY =
  process.env.BERU_PYTHON || (existsSync(environmentPython) ? environmentPython : "python");

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

export function listPythonTests(dir = PYTHON_DIR) {
  return readdirSync(dir)
    .filter((name) => name.startsWith("test_") && name.endsWith(".py"))
    .sort();
}

function main() {
  const files = listPythonTests();
  if (files.length === 0) {
    console.error(`${RED}test:python: no test_*.py files found in ${PYTHON_DIR}${RESET}`);
    process.exit(1);
  }

  console.log(`${DIM}test:python: running ${files.length} test files${RESET}`);

  for (const file of files) {
    process.stdout.write(`\n${DIM}--- python/${file} ---${RESET}\n`);
    const result = spawnSync(PY, [path.join("python", file)], {
      cwd: ROOT,
      stdio: "inherit",
    });
    if (result.error) {
      console.error(`${RED}${file} could not start:${RESET} ${result.error.message}`);
      process.exit(1);
    }
    if (result.status !== 0) {
      console.error(`\n${RED}${file} failed (exit ${result.status})${RESET}`);
      process.exit(result.status ?? 1);
    }
  }

  console.log(`\n${GREEN}test:python: all ${files.length} test files passed${RESET}`);
}

const invokedAs = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedAs.toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  main();
}
