/**
 * Video processing utilities for the Beru application.
 */

export type Region = { x: number; y: number; w: number; h: number };

/** Match text regions drawn on the canvas (float coords) across read/write paths. */
export function regionsMatch(a: Region, b: Region, tolerance = 1): boolean {
  return (
    Math.abs(a.x - b.x) < tolerance &&
    Math.abs(a.y - b.y) < tolerance &&
    Math.abs(a.w - b.w) < tolerance &&
    Math.abs(a.h - b.h) < tolerance
  );
}

/** Find the text operation tied to a template label/region on a queue item. */
export function findTextOpForRegion(
  operations: Operation[],
  templateRegion: Region,
): Operation | undefined {
  return operations.find(
    (o) => o.mode === 'text' && o.region && regionsMatch(o.region, templateRegion),
  );
}

/** True when a queue item has text ops but none with visible content. */
export function hasOnlyEmptyTextOps(operations: Operation[]): boolean {
  const textOps = operations.filter((o) => o.mode === 'text');
  return textOps.length > 0 && textOps.every((o) => !o.text?.trim());
}
export type Operation = {
  id: number;
  mode: string;
  region: Region | null;
  blurStrength?: number;
  startTime?: number | null;
  endTime?: number | null;
  text?: string;
  fontSize?: number;
  fontColor?: string;
  /** Font family name (e.g. "Arial", "Times New Roman"). */
  fontFamily?: string;
  bold?: boolean;
  italic?: boolean;
  /** Whether to render a solid background box behind the text. */
  bgEnabled?: boolean;
  bgColor?: string;
  /** 0..1 background alpha. */
  bgOpacity?: number;
  /** Outline / stroke around glyphs in pixels (0 = none). */
  borderWidth?: number;
  borderColor?: string;
};

export const FONT_FAMILIES = [
  'Arial',
  'Arial Black',
  'Bahnschrift',
  'Calibri',
  'Cambria',
  'Candara',
  'Consolas',
  'Courier New',
  'Franklin Gothic Medium',
  'Georgia',
  'Impact',
  'Segoe UI',
  'Tahoma',
  'Times New Roman',
  'Trebuchet MS',
  'Verdana',
] as const;

export const TEXT_STYLE_PRESETS = [
  {
    name: 'Caption',
    fontFamily: 'Segoe UI',
    fontSize: 34,
    fontColor: 'white',
    bold: true,
    italic: false,
    bgEnabled: true,
    bgColor: 'black',
    bgOpacity: 0.58,
    borderWidth: 0,
    borderColor: 'black',
  },
  {
    name: 'Title',
    fontFamily: 'Arial Black',
    fontSize: 56,
    fontColor: 'white',
    bold: true,
    italic: false,
    bgEnabled: false,
    bgColor: 'black',
    bgOpacity: 0.4,
    borderWidth: 3,
    borderColor: 'black',
  },
  {
    name: 'Clean',
    fontFamily: 'Calibri',
    fontSize: 38,
    fontColor: 'white',
    bold: false,
    italic: false,
    bgEnabled: false,
    bgColor: 'black',
    bgOpacity: 0,
    borderWidth: 2,
    borderColor: 'black',
  },
  {
    name: 'Mono',
    fontFamily: 'Consolas',
    fontSize: 30,
    fontColor: '#f8fafc',
    bold: false,
    italic: false,
    bgEnabled: true,
    bgColor: '#111827',
    bgOpacity: 0.72,
    borderWidth: 0,
    borderColor: 'black',
  },
] as const;

export const MODE_META: Record<string, { label: string; color: string }> = {
  blur: { label: 'Blur', color: 'text-blue-400' },
  crop: { label: 'Crop', color: 'text-amber-400' },
  text: { label: 'Text', color: 'text-purple-400' },
  delogo: { label: 'Delogo', color: 'text-rose-400' },
};

/**
 * Calculate the content rectangle for a video element.
 */
export function contentRect(videoEl: HTMLVideoElement) {
  const br = videoEl.getBoundingClientRect();
  const vr = videoEl.videoWidth / videoEl.videoHeight;
  const cr = br.width / br.height;
  let dw: number, dh: number, ox: number, oy: number;
  if (vr > cr) { dw = br.width; dh = br.width / vr; ox = 0; oy = (br.height - dh) / 2; }
  else { dh = br.height; dw = br.height * vr; ox = (br.width - dw) / 2; oy = 0; }
  return { dw, dh, ox, oy, br };
}

/**
 * Convert canvas coordinates to video coordinates.
 */
export function toVideo(videoEl: HTMLVideoElement, cx: number, cy: number): { x: number; y: number } | null {
  const c = contentRect(videoEl);
  return {
    x: Math.max(0, Math.min((cx - c.br.left - c.ox) * (videoEl.videoWidth / c.dw), videoEl.videoWidth)),
    y: Math.max(0, Math.min((cy - c.br.top - c.oy) * (videoEl.videoHeight / c.dh), videoEl.videoHeight)),
  };
}

/**
 * Draw a region on a canvas.
 */
export function drawRegion(
  canvas: HTMLCanvasElement,
  videoEl: HTMLVideoElement,
  region: Region | null
) {
  if (!canvas || !videoEl) return;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!region) return;

  const c = contentRect(videoEl);
  const sx = c.dw / videoEl.videoWidth;
  const sy = c.dh / videoEl.videoHeight;
  const x = region.x * sx + c.ox;
  const y = region.y * sy + c.oy;
  const w = region.w * sx;
  const h = region.h * sy;

  // Draw region fill
  ctx.fillStyle = 'rgba(6, 182, 212, 0.15)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(6, 182, 212, 0.85)';
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);

  // Draw corner handles
  const ms = Math.min(12, w / 3, h / 3);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2.5;
  for (const [cx, cy, dx1, dy1, dx2, dy2] of [
    [x, y, ms, 0, 0, ms], [x + w, y, -ms, 0, 0, ms],
    [x, y + h, ms, 0, 0, -ms], [x + w, y + h, -ms, 0, 0, -ms],
  ] as [number, number, number, number, number, number][]) {
    ctx.beginPath(); ctx.moveTo(cx + dx1, cy + dy1); ctx.lineTo(cx, cy); ctx.lineTo(cx + dx2, cy + dy2); ctx.stroke();
  }

  // Draw resize handles
  const hs = 7;
  ctx.fillStyle = '#06b6d4';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  for (const [hx, hy] of [
    [x, y], [x + w / 2, y], [x + w, y],
    [x, y + h / 2], [x + w, y + h / 2],
    [x, y + h], [x + w / 2, y + h], [x + w, y + h],
  ] as [number, number][]) {
    ctx.fillRect(hx! - hs / 2, hy! - hs / 2, hs, hs);
    ctx.strokeRect(hx! - hs / 2, hy! - hs / 2, hs, hs);
  }
}
