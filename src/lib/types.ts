/**
 * Shared types for the Beru editor.
 * Re-exports canonical types from video-utils and adds queue/editor types.
 */
export type { Region, Operation } from '$lib/video-utils';
export { MODE_META, FONT_FAMILIES } from '$lib/video-utils';

export type QueueStatus = 'idle' | 'queued' | 'processing' | 'done' | 'error';

export type QueueItem = {
  path: string; src: string; filename: string;
  width: number; height: number; duration: number;
  operations: import('$lib/video-utils').Operation[]; status: QueueStatus;
  progress: number; eta: number | null; speed: number | null;
  error: string | null; customOutputName?: string;
};

export type SidebarMode = 'logo' | 'batch';

/** Template-based text region: drawn on the reference video and applied to all. */
export type TextRegion = {
  id: number;
  region: import('$lib/video-utils').Region;
  label: string; // "text1", "text2", etc.
};

/** Template configuration for the mass-apply workflow. */
export type TemplateConfig = {
  sourceVideoPath: string;
  textRegions: TextRegion[];
};
