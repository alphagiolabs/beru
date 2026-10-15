export const HISTORY_LIMIT = 100;

const pushPast = (past, entry) => [...past, entry].slice(-HISTORY_LIMIT);

export function createHistory(present) {
  return { present, past: [], future: [], gesture: null };
}

export function commit(history, next) {
  if (history.gesture) throw new Error("commit durante un gesto activo");
  if (next === history.present) return history;
  return {
    present: next,
    past: pushPast(history.past, history.present),
    future: [],
    gesture: null,
  };
}

export function beginGesture(history) {
  if (history.gesture) return history;
  return { ...history, gesture: { base: history.present } };
}

export function previewGesture(history, next) {
  if (!history.gesture) throw new Error("preview sin gesto activo");
  return { ...history, present: next };
}

export function endGesture(history) {
  if (!history.gesture) return history;
  const { base } = history.gesture;
  if (history.present === base) return { ...history, gesture: null };
  return {
    present: history.present,
    past: pushPast(history.past, base),
    future: [],
    gesture: null,
  };
}

export function cancelGesture(history) {
  if (!history.gesture) return history;
  return { ...history, present: history.gesture.base, gesture: null };
}

export function undo(history) {
  if (history.gesture || history.past.length === 0) return history;
  const previous = history.past[history.past.length - 1];
  return {
    present: previous,
    past: history.past.slice(0, -1),
    future: [history.present, ...history.future],
    gesture: null,
  };
}

export function redo(history) {
  if (history.gesture || history.future.length === 0) return history;
  const [next, ...future] = history.future;
  return { present: next, past: pushPast(history.past, history.present), future, gesture: null };
}
