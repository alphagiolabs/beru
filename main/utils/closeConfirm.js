const ACK_TIMEOUT_MS = 1500;
const pending = new Map();
let nextId = 0;

// Resolves true/false with the user's answer, or null when the renderer does not
// acknowledge the request in time (no listener mounted), so the caller can fall back.
export function requestCloseConfirm(webContents, channel, payload) {
  const id = ++nextId;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve(null);
    }, ACK_TIMEOUT_MS);
    pending.set(id, { resolve, timer });
    webContents.send(channel, { ...payload, id });
  });
}

export function resolveCloseConfirm(id, { ack = false, confirmed = false } = {}) {
  const entry = pending.get(id);
  if (!entry) return false;
  clearTimeout(entry.timer);
  if (ack) return true;
  pending.delete(id);
  entry.resolve(confirmed === true);
  return true;
}
