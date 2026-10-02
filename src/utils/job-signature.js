import { jobInputs } from "./export-pipeline.js";

export function normalizeJobTimestamp(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function stampJobTimestamp(job, timestamp) {
  return { ...job, timestamp: normalizeJobTimestamp(timestamp) };
}

export function previewJobInputSnapshot(state, videoIdx, draft) {
  return [videoIdx, state.queue[videoIdx], ...jobInputs(state, videoIdx), draft];
}

function timestampTail(ts) {
  return `,"timestamp":${JSON.stringify(ts)}}`;
}

function sameEntry(a, b) {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((k) => Object.is(a[k], b[k]));
}

export function jobInputEntriesEqual(a, b) {
  return a.length === b.length && a.every((v, i) => sameEntry(v, b[i]));
}

export function createJobSignatureCache() {
  let entries = null;
  let body = null;
  let stampedTs;
  let sig = null;

  return function jobSignature(nextEntries, timestamp, buildJob) {
    const ts = normalizeJobTimestamp(timestamp);
    if (entries && jobInputEntriesEqual(nextEntries, entries)) {
      if (body !== null) return body + timestampTail(ts);
      if (Object.is(stampedTs, ts)) return sig;
    }
    const job = buildJob();
    if (!job) {
      entries = null;
      body = null;
      sig = null;
      return null;
    }
    sig = JSON.stringify(job);
    const tail = timestampTail(job.timestamp);
    entries = nextEntries;
    body = sig.endsWith(tail) ? sig.slice(0, sig.length - tail.length) : null;
    stampedTs = job.timestamp;
    return sig;
  };
}
