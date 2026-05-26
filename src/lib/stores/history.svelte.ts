/**
 * History utilities (pure functions, no Svelte state).
 * State stays in the component; these functions operate on history arrays.
 */
import type { Operation } from '$lib/video-utils';

export function opsEqual(a: Operation[], b: Operation[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const oa = a[i]!, ob = b[i]!;
    if (oa.id !== ob.id || oa.mode !== ob.mode || oa.text !== ob.text
      || oa.fontSize !== ob.fontSize || oa.fontColor !== ob.fontColor
      || oa.blurStrength !== ob.blurStrength
      || oa.startTime !== ob.startTime || oa.endTime !== ob.endTime) return false;
    const ra = oa.region, rb = ob.region;
    if (ra && rb) { if (ra.x !== rb.x || ra.y !== rb.y || ra.w !== rb.w || ra.h !== rb.h) return false; }
    else if (!!ra !== !!rb) return false;
  }
  return true;
}

/** Push ops snapshot into the undo stack. Returns new arrays (immutable). */
export function pushHistory(
  history: Operation[][],
  historyIndex: number,
  ops: Operation[]
): { history: Operation[][]; historyIndex: number } {
  if (history.length > 0 && historyIndex >= 0 && opsEqual(ops, history[historyIndex]!)) {
    return { history, historyIndex };
  }
  const next = history.slice(0, historyIndex + 1);
  next.push(structuredClone(ops));
  let idx = next.length - 1;
  if (next.length > 50) { next.shift(); idx--; }
  return { history: next, historyIndex: idx };
}

/** Attempt undo. Returns { ops, historyIndex } or null. */
export function tryUndo(
  history: Operation[][],
  historyIndex: number
): { ops: Operation[]; historyIndex: number } | null {
  if (historyIndex <= 0) return null;
  const idx = historyIndex - 1;
  return { ops: structuredClone(history[idx]!), historyIndex: idx };
}

/** Attempt redo. Returns { ops, historyIndex } or null. */
export function tryRedo(
  history: Operation[][],
  historyIndex: number
): { ops: Operation[]; historyIndex: number } | null {
  if (historyIndex >= history.length - 1) return null;
  const idx = historyIndex + 1;
  return { ops: structuredClone(history[idx]!), historyIndex: idx };
}
