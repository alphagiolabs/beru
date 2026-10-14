import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ probe: null, children: [], watch: null }));

vi.mock("child_process", () => {
  const api = {
    spawnSync: () => mocks.probe,
    spawn: (command, args, options) => {
      const child = new EventEmitter();
      child.pid = 9000 + mocks.children.length;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      mocks.children.push({
        command,
        args: [...args],
        options: { ...options, env: options?.env && { ...options.env } },
        child,
      });
      return child;
    },
  };
  return { default: api, ...api };
});
vi.mock("fs", () => ({
  default: {
    existsSync: () => false,
    watch: (_path, _options, callback) => {
      mocks.watch = callback;
    },
  },
}));
vi.mock("net", () => ({
  default: {
    createServer: () => ({
      unref() {},
      once() {},
      listen(_options, callback) {
        callback();
      },
      close(callback) {
        callback();
      },
    }),
  },
}));
vi.mock("http", () => ({
  default: {
    get: (_url, callback) => {
      const request = new EventEmitter();
      request.setTimeout = () => {};
      callback({ resume() {} });
      return request;
    },
  },
}));

beforeEach(() => {
  vi.resetModules();
  mocks.children = [];
  mocks.watch = null;
  vi.stubEnv("ELECTRON_RUN_AS_NODE", "1");
  vi.stubEnv("BERU_DEV_PORT", "5173");
  vi.spyOn(process, "on").mockReturnValue(process);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("development startup", () => {
  it.each([
    { session: "standard", probe: { status: 1 }, sandbox: true },
    { session: "elevated", probe: { status: 0 }, sandbox: false },
    { session: "unknown", probe: { status: null, error: new Error("ENOENT") }, sandbox: true },
  ])("preserves the sandbox for a $session session when required", async ({ probe, sandbox }) => {
    mocks.probe = probe;
    await import("../scripts/dev.mjs");

    const electron = mocks.children[1];
    expect(electron.args.includes("--no-sandbox")).toBe(!sandbox);
    expect(electron.options.env.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(process.env.ELECTRON_RUN_AS_NODE).toBe("1");

    vi.useFakeTimers();
    mocks.watch("change", "processor.py");
    await vi.advanceTimersByTimeAsync(500);
    const electronProcesses = mocks.children.filter(
      ({ command, args }) => command === electron.command && args[0] === electron.args[0],
    );
    expect(electronProcesses).toHaveLength(2);
    expect(electronProcesses[1].child).not.toBe(electron.child);
    expect(electronProcesses[1].args).toEqual(electron.args);
    expect(electronProcesses[1].options.env.ELECTRON_RUN_AS_NODE).toBeUndefined();
  });
});
