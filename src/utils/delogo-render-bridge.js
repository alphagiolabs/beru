import { createDelogoRenderSession } from "./delogo-render-core.js";

let sharedWorker = null;
let workerUnavailable = false;
let nextSessionId = 0;
const bridges = new Map();

function postShared(message) {
  if (!sharedWorker || workerUnavailable) return;
  try {
    sharedWorker.postMessage(message);
  } catch {
    workerUnavailable = true;
  }
}

function acquireWorker() {
  if (workerUnavailable) return null;
  if (!sharedWorker) {
    try {
      sharedWorker = new Worker(new URL("./delogo-render-worker.js", import.meta.url), {
        type: "module",
      });
      sharedWorker.addEventListener(
        "error",
        () => {
          workerUnavailable = true;
          for (const bridge of bridges.values()) bridge.pending.clear();
          sharedWorker?.terminate();
          sharedWorker = null;
        },
        { once: true },
      );
      sharedWorker.addEventListener("message", (event) => {
        const { sessionId, seq, result } = event.data;
        const bridge = bridges.get(sessionId);
        const entry = bridge?.pending.get(seq);
        if (!entry) return;
        bridge.pending.delete(seq);
        entry.onResult(entry.context, result);
      });
    } catch {
      workerUnavailable = true;
      return null;
    }
  }
  return sharedWorker;
}

export function createDelogoRenderBridge() {
  const sessionId = ++nextSessionId;
  const pending = new Map();
  const localSession = createDelogoRenderSession();
  let seq = 0;
  let released = false;

  const bridge = {
    pending,
    compute({ method, params, frame, width, height, context }, onResult) {
      if (released) return;
      const mySeq = ++seq;
      const worker = acquireWorker();
      if (worker) {
        pending.set(mySeq, { context, onResult });
        try {
          worker.postMessage(
            {
              type: "compute",
              sessionId,
              seq: mySeq,
              method,
              params,
              frame: frame.data.buffer,
              width,
              height,
            },
            [frame.data.buffer],
          );
          return;
        } catch {
          pending.delete(mySeq);
        }
      }
      const result = localSession.compute(method, params, frame.data, width, height);
      onResult(context, result);
    },
    reset() {
      pending.clear();
      localSession.reset();
      postShared({ type: "reset", sessionId });
    },
    release() {
      released = true;
      pending.clear();
      bridges.delete(sessionId);
      postShared({ type: "release", sessionId });
    },
  };
  bridges.set(sessionId, bridge);
  return bridge;
}
