import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class FakeWorker {
  static instances = [];
  constructor() {
    this.listeners = { message: [], error: [] };
    this.sent = [];
    this.terminated = false;
    FakeWorker.instances.push(this);
  }
  addEventListener(type, fn) {
    this.listeners[type].push(fn);
  }
  postMessage(msg) {
    this.sent.push(msg);
  }
  terminate() {
    this.terminated = true;
  }
  emitMessage(data) {
    for (const fn of this.listeners.message) fn({ data });
  }
  emitError() {
    for (const fn of this.listeners.error) fn({});
  }
}

function constantFrame(w, h, value) {
  return { data: new Uint8ClampedArray(w * h * 4).fill(value) };
}

async function loadBridge() {
  vi.resetModules();
  return import("../src/utils/delogo-render-bridge.js");
}

function computeTemporal(bridge, value, onResult) {
  bridge.compute(
    {
      method: "temporal",
      params: { radius: 7 },
      frame: constantFrame(1, 1, value),
      width: 1,
      height: 1,
      context: { value },
    },
    onResult,
  );
}

describe("delogo render bridge (worker path)", () => {
  beforeEach(() => {
    FakeWorker.instances = [];
    vi.stubGlobal("Worker", FakeWorker);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("routes compute messages and delivers worker results", async () => {
    const { createDelogoRenderBridge } = await loadBridge();
    const bridge = createDelogoRenderBridge();
    const results = [];
    computeTemporal(bridge, 10, (context, result) => results.push([context, result]));
    computeTemporal(bridge, 20, (context, result) => results.push([context, result]));

    const worker = FakeWorker.instances[0];
    expect(worker.sent).toHaveLength(2);
    expect(worker.sent[0]).toMatchObject({ type: "compute", method: "temporal", width: 1 });
    expect(results).toHaveLength(0);

    const reply = (seq, value) =>
      worker.emitMessage({
        type: "result",
        sessionId: worker.sent[0].sessionId,
        seq,
        result: { data: Uint8ClampedArray.of(value, 0, 0, 255), width: 1, height: 1 },
      });
    reply(worker.sent[0].seq, 10);
    reply(worker.sent[1].seq, 20);
    expect(results.map(([context]) => context.value)).toEqual([10, 20]);
  });

  it("drops results computed before reset()", async () => {
    const { createDelogoRenderBridge } = await loadBridge();
    const bridge = createDelogoRenderBridge();
    const results = [];
    computeTemporal(bridge, 10, (context, result) => results.push(result));
    const worker = FakeWorker.instances[0];
    const { seq, sessionId } = worker.sent[0];

    bridge.reset();
    expect(worker.sent[1]).toMatchObject({ type: "reset", sessionId });

    worker.emitMessage({
      type: "result",
      sessionId,
      seq,
      result: { data: Uint8ClampedArray.of(10, 0, 0, 255), width: 1, height: 1 },
    });
    expect(results).toHaveLength(0);
  });

  it("drops pending work when the worker fails and keeps computing on the fallback", async () => {
    const { createDelogoRenderBridge } = await loadBridge();
    const bridge = createDelogoRenderBridge();
    const results = [];
    computeTemporal(bridge, 10, (context, result) => results.push(result));
    const worker = FakeWorker.instances[0];
    const { seq, sessionId } = worker.sent[0];

    worker.emitError();
    expect(worker.terminated).toBe(true);

    worker.emitMessage({
      type: "result",
      sessionId,
      seq,
      result: { data: Uint8ClampedArray.of(10, 0, 0, 255), width: 1, height: 1 },
    });
    expect(results).toHaveLength(0);

    computeTemporal(bridge, 7, (context, result) => results.push(result));
    expect(results).toHaveLength(1);
    expect(results[0].data[0]).toBe(7);
  });

  it("drops computes after release()", async () => {
    const { createDelogoRenderBridge } = await loadBridge();
    const bridge = createDelogoRenderBridge();
    computeTemporal(bridge, 1, () => {});
    const worker = FakeWorker.instances[0];

    bridge.release();
    expect(worker.sent[worker.sent.length - 1]).toMatchObject({ type: "release" });

    let called = false;
    computeTemporal(bridge, 1, () => {
      called = true;
    });
    expect(called).toBe(false);
    expect(worker.sent).toHaveLength(2);
  });
});

describe("delogo render bridge (main-thread fallback)", () => {
  beforeEach(() => {
    vi.stubGlobal("Worker", undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("computes synchronously through the local session when workers are unavailable", async () => {
    const { createDelogoRenderBridge } = await loadBridge();
    const bridge = createDelogoRenderBridge();
    const results = [];
    computeTemporal(bridge, 42, (context, result) => results.push({ context, result }));
    expect(results).toHaveLength(1);
    expect(results[0].context).toEqual({ value: 42 });
    expect(results[0].result.data[0]).toBe(42);
    bridge.release();
  });

  it("keeps temporal history across computes and clears it on reset()", async () => {
    const { createDelogoRenderBridge } = await loadBridge();
    const bridge = createDelogoRenderBridge();
    const results = [];
    const compute = (value) =>
      computeTemporal(bridge, value, (_context, result) => results.push(result));
    compute(10);
    compute(20);
    compute(30);
    expect(results.map((r) => r.data[0])).toEqual([10, 15, 20]);
    bridge.reset();
    compute(0);
    expect(results[3].data[0]).toBe(0);
    bridge.release();
  });

  it("drops computes after release()", async () => {
    const { createDelogoRenderBridge } = await loadBridge();
    const bridge = createDelogoRenderBridge();
    bridge.release();
    let called = false;
    computeTemporal(bridge, 7, () => {
      called = true;
    });
    expect(called).toBe(false);
  });
});
