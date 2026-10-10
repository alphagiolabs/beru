#!/usr/bin/env node
import { requireWindows } from "../shared/platform.js";

import { existsSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTestEnvironment } from "./test-environment.mjs";

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

function listPythonTests() {
  return readdirSync(PYTHON_DIR)
    .filter((name) => name.startsWith("test_") && name.endsWith(".py"))
    .sort();
}

function main() {
  const files = listPythonTests();
  if (files.length === 0) {
    console.error(`${RED}test:python: no test_*.py files found in ${PYTHON_DIR}${RESET}`);
    return 1;
  }

  console.log(`${DIM}test:python: running ${files.length} test files${RESET}`);

  const testEnvironment = createTestEnvironment();
  try {
    for (const file of files) {
      process.stdout.write(`\n${DIM}--- python/${file} ---${RESET}\n`);
      const result = spawnSync(PY, [path.join("python", file)], {
        cwd: ROOT,
        stdio: "inherit",
        env: { ...process.env, ...testEnvironment.env },
      });
      if (result.error) {
        console.error(`${RED}${file} could not start:${RESET} ${result.error.message}`);
        return 1;
      }
      if (result.status !== 0) {
        console.error(`\n${RED}${file} failed (exit ${result.status})${RESET}`);
        return result.status ?? 1;
      }
    }
  } finally {
    testEnvironment.cleanup();
  }

  console.log(`\n${GREEN}test:python: all ${files.length} test files passed${RESET}`);
  return 0;
}

const invokedAs = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedAs.toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  process.exitCode = main();
}
