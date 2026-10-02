import { createDelogoRenderSession } from "./delogo-render-core.js";

const sessions = new Map();

self.onmessage = (event) => {
  const msg = event.data;
  if (msg.type === "reset") {
    sessions.get(msg.sessionId)?.reset();
    return;
  }
  if (msg.type === "release") {
    sessions.delete(msg.sessionId);
    return;
  }
  if (msg.type !== "compute") return;
  let session = sessions.get(msg.sessionId);
  if (!session) {
    session = createDelogoRenderSession();
    sessions.set(msg.sessionId, session);
  }
  const frame = new Uint8ClampedArray(msg.frame);
  const result = session.compute(msg.method, msg.params, frame, msg.width, msg.height);
  self.postMessage({ type: "result", sessionId: msg.sessionId, seq: msg.seq, result }, [
    result.data.buffer,
  ]);
};
