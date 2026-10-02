import { EventEmitter } from "events";
import { PassThrough } from "stream";
import { afterEach, describe, expect, it, vi } from "vitest";

const spawn = vi.hoisted(() => vi.fn());
vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, default: { ...actual.default, spawn }, spawn };
});
vi.mock("../main/utils/processor-spawn.js", () => ({
  validateProcessorAvailableAsync: async () => ({ ok: true, command: "python", args: [] }),
  buildProcessorChildEnv: () => ({}),
}));
vi.mock("../main/utils/paths.js", () => ({ validateMediaBinaries: () => ({ ok: false }) }));
vi.mock("../main/utils/kill-process-tree.js", () => ({
  killProcessTree: async (proc) => proc.kill(),
}));

import { disposePreviewFrameWorker, renderPreviewFrame } from "../main/utils/preview-frame.js";

function fakeWorker() {
  const proc = new EventEmitter();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.stdin = new PassThrough();
  vi.spyOn(proc.stdin, "write");
  proc.kill = vi.fn(() => true);
  return proc;
}

afterEach(() => {
  disposePreviewFrameWorker();
  spawn.mockReset();
});

describe("preview worker protocol limits", () => {
  it("settles active and queued previews when a response line exceeds its budget", async () => {
    const proc = fakeWorker();
    spawn.mockReturnValueOnce(proc);
    const first = renderPreviewFrame({ timestamp: 1 });
    await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
    proc.stdout.write('{"type":"ready","ok":true}\n');
    const firstResult = first.then((value) => value);
    await vi.waitFor(() => expect(proc.stdin.write).toHaveBeenCalled());
    const second = renderPreviewFrame({ timestamp: 2 });
    await new Promise((resolve) => setImmediate(resolve));
    proc.stdout.write("X".repeat(7 * 1024 * 1024));
    expect(await firstResult).toMatchObject({ ok: false });
    expect(await second).toMatchObject({ ok: false });
    expect(proc.kill).toHaveBeenCalled();

    const replacement = fakeWorker();
    spawn.mockReturnValueOnce(replacement);
    const next = renderPreviewFrame({ timestamp: 3 });
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(2));
    replacement.stdout.write('{"type":"ready","ok":true}\n');
    await vi.waitFor(() => expect(replacement.stdin.write).toHaveBeenCalled());
    proc.emit("close", null);
    const id = JSON.parse(replacement.stdin.write.mock.calls[0][0]).id;
    replacement.stdout.write(
      `${JSON.stringify({ id, ok: true, data_url: "data:image/jpeg;base64,AA==" })}\n`,
    );
    expect(await next).toMatchObject({ ok: true });
  });

  it("handles stdin errors without crashing or leaving a request unresolved", async () => {
    const proc = fakeWorker();
    spawn.mockReturnValueOnce(proc);
    const result = renderPreviewFrame({ timestamp: 1 });
    await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
    proc.stdout.write('{"type":"ready","ok":true}\n');
    await vi.waitFor(() => expect(proc.stdin.write).toHaveBeenCalled());
    proc.stdin.emit("error", new Error("EPIPE"));
    expect(await result).toMatchObject({ ok: false });
  });

  it("rejects oversized worker input without writing it", async () => {
    const proc = fakeWorker();
    spawn.mockReturnValueOnce(proc);
    const result = renderPreviewFrame({ text: "x".repeat(1024 * 1024) });
    await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
    proc.stdout.write('{"type":"ready","ok":true}\n');
    expect(await result).toMatchObject({ ok: false, error: expect.stringMatching(/límite/) });
    expect(proc.stdin.write).not.toHaveBeenCalled();
  });

  it("settles a queued request when the active request times out", async () => {
    const timer = vi.spyOn(global, "setTimeout");
    const proc = fakeWorker();
    spawn.mockReturnValueOnce(proc);
    const first = renderPreviewFrame({ timestamp: 1 });
    await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
    proc.stdout.write('{"type":"ready","ok":true}\n');
    await vi.waitFor(() => expect(proc.stdin.write).toHaveBeenCalled());
    const second = renderPreviewFrame({ timestamp: 2 });
    await new Promise((resolve) => setImmediate(resolve));
    try {
      const requestTimeout = timer.mock.calls.find(([, ms]) => ms === 60_000);
      expect(requestTimeout).toBeDefined();
      requestTimeout[0]();
      expect(await first).toMatchObject({ ok: false, error: expect.stringMatching(/Timeout/) });
      expect(await second).toMatchObject({ ok: false, error: expect.stringMatching(/Timeout/) });
    } finally {
      timer.mockRestore();
    }
  });
});
