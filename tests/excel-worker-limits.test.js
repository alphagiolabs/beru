import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ workers: [] }));
vi.mock("node:worker_threads", async (importOriginal) => {
  const actual = await importOriginal();
  const { EventEmitter } = await import("node:events");
  class Worker extends EventEmitter {
    constructor() {
      super();
      this.terminate = vi.fn(async () => this.emit("exit", 1));
      mocks.workers.push(this);
    }
  }
  return { ...actual, default: { ...actual.default, Worker }, Worker };
});

import { parseExcelBuffer } from "../main/utils/excel.js";

afterEach(() => {
  vi.useRealTimers();
  mocks.workers.length = 0;
});

describe("Excel parser resource limits", () => {
  it("rejects oversized input before allocating a worker", async () => {
    await expect(parseExcelBuffer(Buffer.alloc(25 * 1024 * 1024 + 1))).rejects.toThrow(/25MB/);
    expect(mocks.workers).toHaveLength(0);
  });

  it("terminates an unresponsive parser and allows another import afterwards", async () => {
    vi.useFakeTimers();
    const pending = parseExcelBuffer(Buffer.from("fixture"));
    const rejected = expect(pending).rejects.toThrow(/Timeout/);
    await vi.advanceTimersByTimeAsync(30_000);
    await rejected;
    expect(mocks.workers[0].terminate).toHaveBeenCalledOnce();

    const next = parseExcelBuffer(Buffer.from("next"));
    mocks.workers[1].emit("message", { ok: true, data: { rows: [], headers: [] } });
    await expect(next).resolves.toEqual({ rows: [], headers: [] });
  });

  it("bounds concurrent imports and frees slots after parser errors and exits", async () => {
    const first = parseExcelBuffer(Buffer.from("first"));
    const second = parseExcelBuffer(Buffer.from("second"));
    const firstError = expect(first).rejects.toThrow("out of memory");
    const secondError = expect(second).rejects.toThrow(/exited/);
    await expect(parseExcelBuffer(Buffer.from("third"))).rejects.toThrow(/demasiadas/);
    expect(mocks.workers).toHaveLength(2);
    mocks.workers[0].emit("error", new Error("out of memory"));
    mocks.workers[1].emit("exit", 1);
    await Promise.all([firstError, secondError]);

    const next = parseExcelBuffer(Buffer.from("next"));
    mocks.workers[2].emit("message", { ok: true, data: { rows: [], headers: [] } });
    await next;
    expect(mocks.workers[2].terminate).toHaveBeenCalledOnce();
  });
});
