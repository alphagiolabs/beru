import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { createTestEnvironment } from "../scripts/test-environment.mjs";
import { describeIfPython } from "./helpers/python.js";

it("isolates child-process fixtures and cleans only its own execution", () => {
  const first = createTestEnvironment();
  const second = createTestEnvironment();
  const siblingFile = path.join(second.directory, "keep.txt");
  try {
    writeFileSync(siblingFile, "another execution");
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
fs.writeFileSync(path.join(os.tmpdir(), 'fixture.txt'), 'child fixture');
fs.mkdirSync(process.env.BERU_LOG_DIR, { recursive: true });
fs.writeFileSync(path.join(process.env.BERU_LOG_DIR, 'processor.log'), 'child log');`,
      ],
      { env: { ...process.env, ...first.env }, encoding: "utf8", timeout: 10000 },
    );
    expect(result.status, result.error?.message || result.stderr).toBe(0);
    expect(readFileSync(path.join(first.directory, "fixture.txt"), "utf8")).toBe("child fixture");
    expect(readFileSync(path.join(first.directory, "logs", "processor.log"), "utf8")).toBe(
      "child log",
    );

    first.cleanup();
    expect(existsSync(first.directory)).toBe(false);
    expect(readFileSync(siblingFile, "utf8")).toBe("another execution");
  } finally {
    first.cleanup();
    second.cleanup();
  }
});

describeIfPython("test environment cleanup", () => {
  it("waits for a Python log handle to close before removing its directory", async () => {
    const environment = createTestEnvironment();
    const child = spawn(
      "python",
      [
        "-u",
        "-c",
        `import os, pathlib, sys, time
log = pathlib.Path(os.environ['BERU_LOG_DIR']) / 'processor.log'
log.parent.mkdir(parents=True)
with log.open('w') as handle:
    print('ready', flush=True)
    sys.stdin.readline()
    time.sleep(0.2)`,
      ],
      { env: { ...process.env, ...environment.env }, timeout: 10000 },
    );
    const exited = once(child, "exit");
    try {
      await once(child.stdout, "data");
      child.stdin.end("release\n");
      environment.cleanup();
      expect(existsSync(environment.directory)).toBe(false);
      const [code] = await exited;
      expect(code).toBe(0);
    } finally {
      child.kill();
      await exited;
      environment.cleanup();
    }
  });
});
