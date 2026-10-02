import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";

const mocks = vi.hoisted(() => ({ execFile: vi.fn() }));
vi.mock("child_process", () => ({
  execFile: mocks.execFile,
  default: { execFile: mocks.execFile },
}));
import { killProcessTree } from "../main/utils/kill-process-tree.js";

beforeEach(() => {
  mocks.execFile.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("Windows process-tree termination", () => {
  it("uses taskkill for the whole tree and waits for completion", async () => {
    let complete;
    mocks.execFile.mockImplementation((_command, _args, _options, callback) => {
      complete = callback;
    });
    const proc = { pid: 123, kill: vi.fn() };
    let finished = false;
    const pending = killProcessTree(proc).then(() => {
      finished = true;
    });
    expect(mocks.execFile).toHaveBeenCalledWith(
      "taskkill",
      ["/F", "/T", "/PID", "123"],
      { windowsHide: true },
      expect.any(Function),
    );
    await Promise.resolve();
    expect(finished).toBe(false);
    complete(null);
    await pending;
    expect(finished).toBe(true);
    expect(proc.kill).not.toHaveBeenCalled();
  });

  it("falls back to the child handle and consumes cleanup errors", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.execFile.mockImplementation((_command, _args, _options, callback) =>
      callback(new Error("taskkill failed")),
    );
    const proc = {
      pid: 123,
      kill: vi.fn(() => {
        throw new Error("already exited");
      }),
    };
    await expect(killProcessTree(proc)).resolves.toBeUndefined();
    expect(proc.kill).toHaveBeenCalledTimes(1);
  });

  it("does not launch taskkill without a process ID", async () => {
    await killProcessTree(null);
    await killProcessTree({});
    expect(mocks.execFile).not.toHaveBeenCalled();
  });
});
