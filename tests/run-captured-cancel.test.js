import { describe, expect, it, vi } from "vitest";

const children = vi.hoisted(() => []);
vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal();
  const spawn = (...args) => {
    const child = actual.spawn(...args);
    const record = { child, closed: false };
    children.push(record);
    child.once("close", () => {
      record.closed = true;
    });
    return child;
  };
  return { ...actual, default: { ...actual.default, spawn }, spawn };
});
import { runCapturedProcess } from "../main/utils/run-captured.js";

describe("captured process cancellation", () => {
  it("kills a real child and waits for exit before releasing its media slot", async () => {
    const controller = new AbortController();
    const result = runCapturedProcess(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      spawnOptions: { signal: controller.signal },
    });
    controller.abort();
    expect(await result).toMatchObject({ cancelled: true, error: { name: "AbortError" } });
    expect(children.at(-1).closed).toBe(true);
  });

  it("does not spawn with an already aborted signal", async () => {
    const count = children.length;
    const controller = new AbortController();
    controller.abort();
    expect(
      await runCapturedProcess(process.execPath, [], {
        stdoutMode: "buffer",
        spawnOptions: { signal: controller.signal },
      }),
    ).toMatchObject({ cancelled: true, stdout: Buffer.alloc(0) });
    expect(children).toHaveLength(count);
  });
});
