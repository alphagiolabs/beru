/**
 * Queue utilities (pure functions, no Svelte state).
 * State stays in the component; these functions compute values and build payloads.
 */
import type { QueueItem } from '$lib/types';
import type { Operation } from '$lib/video-utils';

const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.flv', '.wmv'];

export function isVideoFilename(name: string): boolean {
  const ext = '.' + name.split('.').pop()?.toLowerCase();
  return VIDEO_EXTENSIONS.includes(ext);
}

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** Count ready items in the queue. */
export function getQueueCount(queue: QueueItem[]): number {
  let ready = 0;
  for (let i = 0; i < queue.length; i++) {
    const q = queue[i]!;
    if (q.operations.length > 0) ready++;
  }
  return ready;
}

/** Build a single VideoJob payload for the Rust backend. */
export function buildJobPayload(
  q: QueueItem,
  originalIndex: number,
  textForPreview: (op: Operation) => string,
  exportFormat: string,
  speedPreset: string,
) {
  let outPath = q.path.replace(/(\.[^.]+)$/, `_edited.${exportFormat}`);
  if (q.customOutputName) {
    outPath = q.path.replace(/[^\\/]+(\.[^.]+)$/, `${q.customOutputName}.${exportFormat}`);
  }
  return {
    input_path: q.path,
    output_path: outPath,
    original_index: originalIndex,
    operations: q.operations.map(op => ({
      mode: op.mode,
      region: op.region ? {
        x: Math.floor(op.region.x), y: Math.floor(op.region.y),
        w: Math.floor(op.region.w), h: Math.floor(op.region.h),
      } : null,
      blur_strength: op.blurStrength ?? 20,
      start_time: op.startTime, end_time: op.endTime,
      text: op.mode === 'text' ? textForPreview(op) : op.text,
      font_size: op.fontSize, font_color: op.fontColor ?? 'white',
      font_family: op.fontFamily ?? null,
      bold: op.bold ?? null,
      italic: op.italic ?? null,
      bg_enabled: op.bgEnabled ?? null,
      bg_color: op.bgColor ?? null,
      bg_opacity: op.bgOpacity ?? null,
      border_width: op.borderWidth ?? null,
      border_color: op.borderColor ?? null,
    })),
    video_duration: q.duration,
    speed_preset: speedPreset,
  };
}

/** Serialize the queue for auto-save. */
export function serializeQueueForSave(queue: QueueItem[]) {
  return queue.map(q => ({
    ...q,
    operations: q.operations.map(op => ({ ...op, region: op.region ? { ...op.region } : null })),
  }));
}

/** Remove an item from queue by index. */
export function removeQueueItemAt(queue: QueueItem[], idx: number): QueueItem[] {
  return queue.filter((_, i) => i !== idx);
}

/** Reorder a queue item from one index to another. */
export function reorderQueueItems(queue: QueueItem[], from: number, to: number): QueueItem[] {
  if (from === to || from < 0 || to < 0 || from >= queue.length || to >= queue.length) return queue;
  const item = queue[from]!;
  const next = queue.filter((_, i) => i !== from);
  return [...next.slice(0, to), item, ...next.slice(to)];
}
