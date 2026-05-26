<script lang="ts">
  import { open } from '@tauri-apps/plugin-dialog';
  import { invoke, convertFileSrc } from '@tauri-apps/api/core';
  import { listen } from '@tauri-apps/api/event';
  import * as XLSX from 'xlsx';
  import { hasOnlyEmptyTextOps, regionsMatch } from '$lib/video-utils';
  import type { Region, Operation, QueueItem, SidebarMode, TextRegion } from '$lib/types';
  import { pushHistory, tryUndo, tryRedo } from '$lib/stores/history.svelte';
  import { onMount } from 'svelte';

  import Header from '$lib/components/Header.svelte';
  import QueueSidebar from '$lib/components/QueueSidebar.svelte';
  import BatchProgressBar from '$lib/components/BatchProgressBar.svelte';
  import DragOverlay from '$lib/components/DragOverlay.svelte';
  import ToolBar from '$lib/components/ToolBar.svelte';
  import StyleEditor from '$lib/components/StyleEditor.svelte';
  import PresetManager, { type TextPreset } from '$lib/components/PresetManager.svelte';
  import LayerList from '$lib/components/LayerList.svelte';
  import BatchPanel from '$lib/components/BatchPanel.svelte';
  import TableEditor from '$lib/components/TableEditor.svelte';
  import ShortcutsModal from '$lib/components/ShortcutsModal.svelte';

  function touchQueue() { queue = [...queue]; }
  function updateOps(fn: (ops: Operation[]) => Operation[]) {
    if (selectedIdx < 0 || selectedIdx >= queue.length) return;
    const item = queue[selectedIdx]!;
    item.operations = fn(item.operations);
    touchQueue();
  }

  // ── Core state ────────────────────────────────────────────────────────
  let queue = $state<QueueItem[]>([]);
  let selectedIdx = $state<number>(-1);
  let isProcessingAll = $state(false);
  let batchSummary = $state<{total:number;succeeded:number;failed:number} | null>(null);
  let showShortcuts = $state(false);
  let showTableEditor = $state(false);
  let speedPreset = $state('ultrafast');
  let sidebarMode = $state<SidebarMode>('logo');
  let exportFormat = $state('mp4');
  let activeTool = $state<'blur' | 'crop' | 'text' | 'delogo'>('blur');

  // ── Text drag state ───────────────────────────────────────────────────
  let draggingOpIdx = $state<number>(-1);
  let dragStartVideo = $state<{x:number;y:number}>({x:0,y:0});
  let dragStartRegion = $state<Region>({x:0,y:0,w:0,h:0});
  let resizingOpIdx = $state<number>(-1);
  let opResizeHandle = $state<string | null>(null);
  let opResizeStart = $state<{cx:number;cy:number;r:Region}>({cx:0,cy:0,r:{x:0,y:0,w:0,h:0}});
  let hoveredOpIdx = $state<number>(-1);

  // ── Template state ────────────────────────────────────────────────────
  let templateIdx = $state<number>(-1);
  let templateRegions = $state<TextRegion[]>([]);
  let nextRegionLabel = $state(1);

  // ── Rich text style state ─────────────────────────────────────────────
  let textFontFamily = $state<string>('Arial');
  let textBold = $state(false);
  let textItalic = $state(false);
  let textBgEnabled = $state(true);
  let textBgColor = $state('black');
  let textBgOpacity = $state(0.65);
  let textBorderWidth = $state(0);
  let textBorderColor = $state('black');

  // ── Presets ───────────────────────────────────────────────────────────
  let presets = $state<TextPreset[]>([]);
  let presetManager = $state<PresetManager>();

  // ── Undo/redo ─────────────────────────────────────────────────────────
  let history = $state<Operation[][]>([]);
  let historyIndex = $state(-1);

  function saveToHistoryLocal() {
    if (selectedIdx < 0 || selectedIdx >= queue.length) return;
    const ops = queue[selectedIdx]!.operations;
    const result = pushHistory(history, historyIndex, ops);
    history = result.history;
    historyIndex = result.historyIndex;
  }

  function undo() {
    const result = tryUndo(history, historyIndex);
    if (result && selectedIdx >= 0 && selectedIdx < queue.length) {
      historyIndex = result.historyIndex;
      queue[selectedIdx]!.operations = result.ops;
      touchQueue();
    }
  }

  function redo() {
    const result = tryRedo(history, historyIndex);
    if (result && selectedIdx >= 0 && selectedIdx < queue.length) {
      historyIndex = result.historyIndex;
      queue[selectedIdx]!.operations = result.ops;
      touchQueue();
    }
  }

  $effect(() => {
    void selectedIdx;
    history = [];
    historyIndex = -1;
  });

  // ── Drag & drop ───────────────────────────────────────────────────────
  let isDragging = $state(false);
  let dragDepth = 0;

  // ── Batch find & replace ──────────────────────────────────────────────
  let batchFindText = $state('');
  let batchReplaceText = $state('');
  let batchFindScope = $state<'selected' | 'all'>('selected');

  function batchFindReplace() {
    const find = batchFindText.trim();
    if (!find) { alert('Enter a text to find.'); return; }
    let count = 0;
    const items = batchFindScope === 'all' ? queue : (selected ? [selected] : []);
    saveToHistoryLocal();
    for (const item of items) {
      for (let j = 0; j < item.operations.length; j++) {
        const op = item.operations[j]!;
        if (op.mode === 'text' && op.text && op.text.includes(find)) {
          item.operations[j] = { ...op, text: op.text.replaceAll(find, batchReplaceText) };
          count++;
        }
      }
      item.operations = [...item.operations];
    }
    touchQueue();
    alert(`Replaced in ${count} layer(s).`);
  }

  function isFileDrag(e: DragEvent): boolean {
    return Array.from(e.dataTransfer?.types ?? []).includes('Files');
  }

  function onDragEnter(e: DragEvent) {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragDepth++;
    isDragging = true;
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  }

  function onDragOver(e: DragEvent) {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    isDragging = true;
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  }

  function onDragLeave(e: DragEvent) {
    if (!isFileDrag(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    isDragging = dragDepth > 0;
  }

  const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.flv', '.wmv'];

  async function onDrop(e: DragEvent) {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragDepth = 0;
    isDragging = false;
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;
    const paths: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i]!;
      const ext = '.' + f.name.split('.').pop()?.toLowerCase();
      if (!VIDEO_EXTENSIONS.includes(ext)) continue;
      const nativePath = (f as File & { path?: string }).path;
      if (nativePath) paths.push(nativePath);
    }
    if (paths.length > 0) await addVideoFromPaths(paths);
  }

  // ── Canvas / video ────────────────────────────────────────────────────
  let videoEl = $state<HTMLVideoElement>();
  let canvas = $state<HTMLCanvasElement>();

  let region = $state<Region | null>(null);
  let isDrawing = $state(false);
  let drawStart = { x: 0, y: 0 };

  let resizing = $state(false);
  let resizeHandle = $state<string | null>(null);
  let resizeStart = { cx: 0, cy: 0, r: { x: 0, y: 0, w: 0, h: 0 } };

  let tempStart = $state<number | null>(null);
  let tempEnd = $state<number | null>(null);
  let blurStrength = $state(20);
  let textInput = $state('Sample Text');
  let textFontSize = $state(32);
  let textFontColor = $state('white');

  const selected = $derived(selectedIdx >= 0 && selectedIdx < queue.length ? queue[selectedIdx] : null);

  // ── Auto-save ─────────────────────────────────────────────────────────
  let autoSaveTimer: ReturnType<typeof setInterval> | null = null;

  function enableAutoSave() {
    if (autoSaveTimer) clearInterval(autoSaveTimer);
    autoSaveTimer = setInterval(() => {
      try {
        localStorage.setItem('beru-autosave', JSON.stringify({
          queue: queue.map(q => ({
            ...q,
            operations: q.operations.map(op => ({ ...op, region: op.region ? { ...op.region } : null })),
          })),
          selectedIdx,
          templateIdx,
          templateRegions,
        }));
      } catch (e) {
        console.error('Auto-save failed:', e);
        try { localStorage.removeItem('beru-autosave'); } catch {}
      }
    }, 30000);
  }

  function loadAutoSave() {
    try {
      const saved = localStorage.getItem('beru-autosave');
      if (!saved) return;
      const state = JSON.parse(saved);
      if (state.queue && Array.isArray(state.queue) && state.queue.length > 0) {
        queue = state.queue;
        selectedIdx = state.selectedIdx ?? -1;
        if (selectedIdx >= queue.length) selectedIdx = queue.length - 1;
        templateIdx = state.templateIdx ?? -1;
        templateRegions = state.templateRegions ?? [];
      }
    } catch (e) {
      console.error('Failed to load autosave:', e);
    }
  }

  onMount(() => {
    loadAutoSave();
    presetManager?.loadFromStorage();
    enableAutoSave();
    return () => { if (autoSaveTimer) clearInterval(autoSaveTimer); };
  });

  // ── Canvas drawing ────────────────────────────────────────────────────
  function fitCanvas() {
    if (!videoEl || !canvas) return;
    const rect = videoEl.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
    drawRegion();
  }

  function drawRegion() {
    if (!canvas || !videoEl) return;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!region) return;

    const c = contentRect();
    if (!c) return;
    const sx = c.dw / videoEl.videoWidth;
    const sy = c.dh / videoEl.videoHeight;
    const x = region.x * sx + c.ox;
    const y = region.y * sy + c.oy;
    const w = region.w * sx;
    const h = region.h * sy;

    if (activeTool === 'crop') {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.fillRect(0, 0, canvas.width, y);
      ctx.fillRect(0, y + h, canvas.width, canvas.height - y - h);
      ctx.fillRect(0, y, x, h);
      ctx.fillRect(x + w, y, canvas.width - x - w, h);
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([]);
    } else if (activeTool === 'delogo') {
      ctx.fillStyle = 'rgba(239, 68, 68, 0.18)';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.9)';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);
      // X marks the logo to remove
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.45)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(x, y); ctx.lineTo(x + w, y + h);
      ctx.moveTo(x + w, y); ctx.lineTo(x, y + h);
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      ctx.fillStyle = 'rgba(0, 240, 234, 0.12)';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = 'rgba(0, 240, 234, 0.9)';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);
    }

    const cornerColor = activeTool === 'crop' ? '#fbbf24' : activeTool === 'delogo' ? '#ef4444' : '#ffffff';
    const ms = Math.min(12, w / 3, h / 3);
    ctx.strokeStyle = cornerColor;
    ctx.lineWidth = 2.5;
    for (const [cx, cy, dx1, dy1, dx2, dy2] of [
      [x, y, ms, 0, 0, ms], [x + w, y, -ms, 0, 0, ms],
      [x, y + h, ms, 0, 0, -ms], [x + w, y + h, -ms, 0, 0, -ms],
    ] as [number, number, number, number, number, number][]) {
      ctx.beginPath(); ctx.moveTo(cx + dx1, cy + dy1); ctx.lineTo(cx, cy); ctx.lineTo(cx + dx2, cy + dy2); ctx.stroke();
    }

    const hs = 7;
    ctx.fillStyle = activeTool === 'crop' ? '#fbbf24' : activeTool === 'delogo' ? '#ef4444' : '#00f0ea';
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

  $effect(() => {
    if (videoEl && canvas) {
      const ro = new ResizeObserver(() => fitCanvas());
      ro.observe(videoEl);
      fitCanvas();
      return () => ro.disconnect();
    }
  });

  $effect(() => {
    if (region !== null) drawRegion();
  });

  $effect(() => {
    void activeTool;
    drawRegion();
  });

  // ── Canvas coordinate helpers ─────────────────────────────────────────
  function contentRect() {
    if (!videoEl) return null;
    const br = videoEl.getBoundingClientRect();
    if (br.width === 0 || br.height === 0) return null;
    const vr = videoEl.videoWidth / videoEl.videoHeight;
    const cr = br.width / br.height;
    let dw: number, dh: number, ox: number, oy: number;
    if (vr > cr) { dw = br.width; dh = br.width / vr; ox = 0; oy = (br.height - dh) / 2; }
    else { dh = br.height; dw = br.height * vr; ox = (br.width - dw) / 2; oy = 0; }
    return { dw, dh, ox, oy, br };
  }

  function regionToScreen(r: Region | null): { x: number; y: number; w: number; h: number; sx: number; sy: number } | null {
    if (!r || !videoEl) return null;
    const c = contentRect();
    if (!c) return null;
    const sx = c.dw / videoEl.videoWidth;
    const sy = c.dh / videoEl.videoHeight;
    return { x: r.x * sx + c.ox, y: r.y * sy + c.oy, w: r.w * sx, h: r.h * sy, sx, sy };
  }

  function cssFontFamily(family: string | undefined): string {
    return `"${(family ?? 'Arial').replace(/"/g, '\\"')}", sans-serif`;
  }

  function toVideo(cx: number, cy: number): { x: number; y: number } | null {
    if (!videoEl) return null;
    const c = contentRect();
    if (!c) return null;
    return {
      x: Math.max(0, Math.min((cx - c.br.left - c.ox) * (videoEl.videoWidth / c.dw), videoEl.videoWidth)),
      y: Math.max(0, Math.min((cy - c.br.top - c.oy) * (videoEl.videoHeight / c.dh), videoEl.videoHeight)),
    };
  }

  // ── Canvas interaction ────────────────────────────────────────────────
  function onCanvasDown(e: MouseEvent) {
    if (!videoEl || resizing) return;
    if (!videoEl.paused) videoEl.pause();
    const v = toVideo(e.clientX, e.clientY);
    if (!v) return;
    drawStart = { x: v.x, y: v.y };
    isDrawing = true;
    region = { x: v.x, y: v.y, w: 0, h: 0 };
  }

  function onCanvasMove(e: MouseEvent) {
    if (isDrawing) {
      const v = toVideo(e.clientX, e.clientY);
      if (!v) return;
      region = {
        x: Math.min(drawStart.x, v.x), y: Math.min(drawStart.y, v.y),
        w: Math.abs(v.x - drawStart.x), h: Math.abs(v.y - drawStart.y),
      };
    } else if (resizing && resizeHandle) {
      doResize(e.clientX, e.clientY);
    }
  }

  function onCanvasUp() {
    isDrawing = false;
    if (resizing) { resizing = false; resizeHandle = null; }
    if (draggingOpIdx >= 0) {
      draggingOpIdx = -1;
      queue = [...queue];
    }
    if (resizingOpIdx >= 0) {
      resizingOpIdx = -1;
      opResizeHandle = null;
      queue = [...queue];
    }
  }

  const CURSORS: Record<string, string> = {
    tl: 'nwse-resize', tc: 'ns-resize', tr: 'nesw-resize',
    ml: 'ew-resize', mr: 'ew-resize',
    bl: 'nesw-resize', bc: 'ns-resize', br: 'nwse-resize',
  };

  function hitTestHandle(cx: number, cy: number): string | null {
    if (!region || !videoEl || !canvas) return null;
    const c = contentRect();
    if (!c) return null;
    const sx = c.dw / videoEl.videoWidth;
    const sy = c.dh / videoEl.videoHeight;
    const rx = region.x * sx + c.ox + c.br.left;
    const ry = region.y * sy + c.oy + c.br.top;
    const rw = region.w * sx;
    const rh = region.h * sy;
    const T = 16;
    const handles: Record<string, [number, number]> = {
      tl: [rx, ry], tc: [rx + rw / 2, ry], tr: [rx + rw, ry],
      ml: [rx, ry + rh / 2], mr: [rx + rw, ry + rh / 2],
      bl: [rx, ry + rh], bc: [rx + rw / 2, ry + rh], br: [rx + rw, ry + rh],
    };
    for (const [name, [hx, hy]] of Object.entries(handles)) {
      if (Math.abs(cx - hx) < T && Math.abs(cy - hy) < T) return name;
    }
    return null;
  }

  function hitTestOp(cx: number, cy: number): number {
    if (!selected || !videoEl) return -1;
    const v = toVideo(cx, cy);
    if (!v) return -1;
    for (let i = selected.operations.length - 1; i >= 0; i--) {
      const op = selected.operations[i]!;
      if (op.mode !== 'text' || !op.region) continue;
      const r = op.region;
      if (v.x >= r.x && v.x <= r.x + r.w && v.y >= r.y && v.y <= r.y + r.h) return i;
    }
    return -1;
  }

  function hitTestOpHandle(cx: number, cy: number, opIdx: number): string | null {
    if (!selected || !videoEl || opIdx < 0) return null;
    const op = selected.operations[opIdx];
    if (!op || !op.region) return null;
    const c = contentRect();
    if (!c) return null;
    const sx = c.dw / videoEl.videoWidth;
    const sy = c.dh / videoEl.videoHeight;
    const r = op.region;
    const rx = r.x * sx + c.ox + c.br.left;
    const ry = r.y * sy + c.oy + c.br.top;
    const rw = r.w * sx;
    const rh = r.h * sy;
    const T = 12;
    const handles: Record<string, [number, number]> = {
      tl: [rx, ry], tr: [rx + rw, ry],
      bl: [rx, ry + rh], br: [rx + rw, ry + rh],
    };
    for (const [name, [hx, hy]] of Object.entries(handles)) {
      if (Math.abs(cx - hx) < T && Math.abs(cy - hy) < T) return name;
    }
    return null;
  }

  function onCanvasMouseMove(e: MouseEvent) {
    if (isDrawing || resizing) { onCanvasMove(e); return; }
    if (draggingOpIdx >= 0) {
      const v = toVideo(e.clientX, e.clientY);
      if (!v || !selected) return;
      const op = selected.operations[draggingOpIdx];
      if (!op || !op.region) return;
      const dx = v.x - dragStartVideo.x;
      const dy = v.y - dragStartVideo.y;
      op.region = {
        x: Math.max(0, dragStartRegion.x + dx),
        y: Math.max(0, dragStartRegion.y + dy),
        w: dragStartRegion.w,
        h: dragStartRegion.h,
      };
      queue = [...queue];
      return;
    }
    if (resizingOpIdx >= 0 && opResizeHandle) {
      doOpResize(e.clientX, e.clientY);
      return;
    }
    const hitOp = hitTestOp(e.clientX, e.clientY);
    hoveredOpIdx = hitOp;
    if (hitOp >= 0) {
      const handle = hitTestOpHandle(e.clientX, e.clientY, hitOp);
      if (handle && canvas) canvas.style.cursor = CURSORS[handle] ?? 'grab';
      else if (canvas) canvas.style.cursor = 'grab';
      return;
    }
    const h = hitTestHandle(e.clientX, e.clientY);
    if (h && canvas) canvas.style.cursor = CURSORS[h] ?? 'crosshair';
    else if (canvas) canvas.style.cursor = 'crosshair';
  }

  function onCanvasMouseDown(e: MouseEvent) {
    if (hoveredOpIdx >= 0) {
      const handle = hitTestOpHandle(e.clientX, e.clientY, hoveredOpIdx);
      if (handle && selected) {
        const op = selected.operations[hoveredOpIdx];
        if (op?.region) {
          saveToHistoryLocal();
          resizingOpIdx = hoveredOpIdx;
          opResizeHandle = handle;
          const v = toVideo(e.clientX, e.clientY);
          opResizeStart = { cx: v?.x ?? 0, cy: v?.y ?? 0, r: { ...op.region } };
          return;
        }
      }
    }
    const hitOp = hitTestOp(e.clientX, e.clientY);
    if (hitOp >= 0 && selected) {
      const op = selected.operations[hitOp];
      if (op?.region) {
        saveToHistoryLocal();
        draggingOpIdx = hitOp;
        const v = toVideo(e.clientX, e.clientY);
        dragStartVideo = { x: v?.x ?? 0, y: v?.y ?? 0 };
        dragStartRegion = { ...op.region };
        return;
      }
    }
    const h = hitTestHandle(e.clientX, e.clientY);
    if (h && region) {
      resizing = true;
      resizeHandle = h;
      const v = toVideo(e.clientX, e.clientY);
      resizeStart = { cx: v?.x ?? e.clientX, cy: v?.y ?? e.clientY, r: { ...region } };
      return;
    }
    onCanvasDown(e);
  }

  function doOpResize(cx: number, cy: number) {
    if (!opResizeHandle || resizingOpIdx < 0 || !selected) return;
    const op = selected.operations[resizingOpIdx];
    if (!op?.region) return;
    const v = toVideo(cx, cy);
    if (!v) return;
    const dx = v.x - opResizeStart.cx;
    const dy = v.y - opResizeStart.cy;
    const sr = opResizeStart.r;
    const MIN = 10;
    const h = opResizeHandle;
    let nx = sr.x, ny = sr.y, nw = sr.w, nh = sr.h;
    if (h.includes('l')) { nx = sr.x + dx; nw = sr.w - dx; }
    if (h.includes('r')) { nw = sr.w + dx; }
    if (h.includes('t')) { ny = sr.y + dy; nh = sr.h - dy; }
    if (h.includes('b')) { nh = sr.h + dy; }
    if (nw < MIN) { nw = MIN; if (h.includes('l')) nx = sr.x + sr.w - MIN; }
    if (nh < MIN) { nh = MIN; if (h.includes('t')) ny = sr.y + sr.h - MIN; }
    op.region = { x: Math.max(0, nx), y: Math.max(0, ny), w: nw, h: nh };
    queue = [...queue];
  }

  function doResize(cx: number, cy: number) {
    if (!resizeHandle) return;
    const v = toVideo(cx, cy);
    if (!v) return;
    const dx = v.x - resizeStart.cx;
    const dy = v.y - resizeStart.cy;
    const sr = resizeStart.r;
    const MIN = 10;
    const h = resizeHandle;
    let nx = sr.x, ny = sr.y, nw = sr.w, nh = sr.h;
    if (h.includes('l')) { nx = sr.x + dx; nw = sr.w - dx; }
    if (h.includes('r')) { nw = sr.w + dx; }
    if (h.includes('t') || h === 'tc') { ny = sr.y + dy; nh = sr.h - dy; }
    if (h.includes('b') || h === 'bc') { nh = sr.h + dy; }
    if (nw < MIN) { nw = MIN; if (h.includes('l')) nx = sr.x + sr.w - MIN; }
    if (nh < MIN) { nh = MIN; if (h.includes('t') || h === 'tc') ny = sr.y + sr.h - MIN; }
    region = { x: Math.max(0, nx), y: Math.max(0, ny), w: nw, h: nh };
  }

  // ── Queue operations ──────────────────────────────────────────────────
  async function addVideoFromPaths(paths: string[]) {
    for (const path of paths) {
      if (queue.some(q => q.path === path)) continue;
      const filename = path.split(/[/\\]/).pop() ?? path;
      const src = convertFileSrc(path);
      let width = 0, height = 0, duration = 0;
      try {
        const info: any = await invoke('get_video_info', { path });
        duration = info.duration ?? 0;
        width = info.width ?? 0;
        height = info.height ?? 0;
        if (width === 0 || height === 0) {
          const raw: string = info.raw_info ?? '';
          const resMatch = raw.match(/(\d{2,5})x(\d{2,5})/);
          if (resMatch) { width = parseInt(resMatch[1]!); height = parseInt(resMatch[2]!); }
        }
      } catch {}
      queue = [...queue, {
        path, src, filename, width, height, duration,
        operations: [], status: 'idle', progress: 0, eta: null, speed: null, error: null,
      }];
    }
    if (selectedIdx < 0 && queue.length > 0) selectedIdx = 0;
  }

  async function addVideo() {
    const sel = await open({
      multiple: true,
      filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm', 'flv'] }],
    });
    if (!sel) return;
    const paths = Array.isArray(sel) ? sel : [sel];
    await addVideoFromPaths(paths);
  }

  function selectQueueItem(idx: number) {
    selectedIdx = idx;
    region = null;
    tempStart = null;
    tempEnd = null;
    setTimeout(fitCanvas, 60);
  }

  function removeQueueItem(idx: number) {
    queue = queue.filter((_, i) => i !== idx);
    if (selectedIdx > idx) selectedIdx = Math.max(0, selectedIdx - 1);
    if (selectedIdx >= queue.length) selectedIdx = queue.length - 1;
  }

  // ── Operation management ──────────────────────────────────────────────
  function addOperation(mode: string) {
    if (!region || selectedIdx < 0) return;
    saveToHistoryLocal();
    const op: Operation = {
      id: Date.now(), mode, region: { ...region },
      blurStrength: mode === 'blur' ? blurStrength : undefined,
      startTime: tempStart, endTime: tempEnd,
      ...(mode === 'text' ? {
        text: textInput,
        fontSize: textFontSize,
        fontColor: textFontColor,
        fontFamily: textFontFamily,
        bold: textBold,
        italic: textItalic,
        bgEnabled: textBgEnabled,
        bgColor: textBgColor,
        bgOpacity: textBgOpacity,
        borderWidth: textBorderWidth,
        borderColor: textBorderColor,
      } : {}),
    };
    updateOps(ops => [...ops, op]);
    region = null;
    tempStart = null;
    tempEnd = null;
    drawRegion();
  }

  function addTemplateRegion() {
    if (!region) { alert('Draw a region on the video first.'); return; }
    templateRegions = [...templateRegions, {
      id: Date.now(),
      region: { ...region },
      label: `text${nextRegionLabel}`,
    }];
    nextRegionLabel++;
    region = null;
    drawRegion();
  }

  function removeTemplateRegion(id: number) {
    templateRegions = templateRegions.filter(r => r.id !== id);
  }

  function setTemplate(idx: number) {
    templateIdx = idx;
    templateRegions = [];
    nextRegionLabel = 1;
  }

  function removeOp(opIdx: number) { updateOps(ops => ops.filter((_, i) => i !== opIdx)); }
  function clearOps() { updateOps(() => []); }

  function moveOp(opIdx: number, direction: -1 | 1) {
    updateOps(ops => {
      const newIdx = opIdx + direction;
      if (newIdx < 0 || newIdx >= ops.length) return ops;
      const next = [...ops];
      [next[opIdx], next[newIdx]] = [next[newIdx]!, next[opIdx]!];
      return next;
    });
  }

  function duplicateOp(opIdx: number) {
    if (selectedIdx < 0 || selectedIdx >= queue.length) return;
    const item = queue[selectedIdx]!;
    const op = item.operations[opIdx];
    if (!op) return;
    const dup: Operation = { ...op, id: Date.now(), region: op.region ? { ...op.region } : null };
    updateOps(ops => [...ops.slice(0, opIdx + 1), dup, ...ops.slice(opIdx + 1)]);
  }

  function editOpRegion(opIdx: number) {
    if (selectedIdx < 0 || selectedIdx >= queue.length) return;
    const item = queue[selectedIdx]!;
    const op = item.operations[opIdx];
    if (!op) return;
    if (op.region) {
      region = { ...op.region };
      blurStrength = op.blurStrength ?? 20;
      tempStart = op.startTime ?? null;
      tempEnd = op.endTime ?? null;
      removeOp(opIdx);
      drawRegion();
    }
  }

  function applyStyleToOp(opIdx: number) {
    if (selectedIdx < 0 || selectedIdx >= queue.length) return;
    const item = queue[selectedIdx]!;
    const op = item.operations[opIdx];
    if (!op || op.mode !== 'text') return;
    saveToHistoryLocal();
    op.fontFamily = textFontFamily;
    op.bold = textBold;
    op.italic = textItalic;
    op.fontSize = textFontSize;
    op.fontColor = textFontColor;
    op.bgEnabled = textBgEnabled;
    op.bgColor = textBgColor;
    op.bgOpacity = textBgOpacity;
    op.borderWidth = textBorderWidth;
    op.borderColor = textBorderColor;
    touchQueue();
  }

  function autoPositionText(mode: 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right') {
    if (!videoEl || selectedIdx < 0) return;
    const vw = videoEl.videoWidth;
    const vh = videoEl.videoHeight;
    const padding = Math.min(vw, vh) * 0.05;
    const textWidth = vw * 0.3;
    const textHeight = vh * 0.1;
    let x = padding, y = padding;
    if (mode === 'center') { x = vw / 2 - textWidth / 2; y = vh / 2 - textHeight / 2; }
    else if (mode === 'top-right') { x = vw - textWidth - padding; y = padding; }
    else if (mode === 'bottom-left') { x = padding; y = vh - textHeight - padding; }
    else if (mode === 'bottom-right') { x = vw - textWidth - padding; y = vh - textHeight - padding; }
    region = { x: Math.max(0, x), y: Math.max(0, y), w: textWidth, h: textHeight };
    drawRegion();
  }

  function detectContrast(): 'light' | 'dark' | 'neutral' {
    if (!videoEl) return 'neutral';
    const vw = videoEl.videoWidth;
    const vh = videoEl.videoHeight;
    const sampleSize = 0.1;
    const sw = Math.max(1, Math.floor(vw * sampleSize));
    const sh = Math.max(1, Math.floor(vh * sampleSize));
    const offscreen = document.createElement('canvas');
    offscreen.width = sw;
    offscreen.height = sh;
    const ctx = offscreen.getContext('2d');
    if (!ctx) return 'neutral';
    const sx = Math.floor(vw * (1 - sampleSize) / 2);
    const sy = Math.floor(vh * (1 - sampleSize) / 2);
    ctx.drawImage(videoEl, sx, sy, sw, sh, 0, 0, sw, sh);
    const imageData = ctx.getImageData(0, 0, sw, sh);
    const data = imageData.data;
    let totalBrightness = 0;
    for (let i = 0; i < data.length; i += 4) {
      totalBrightness += (data[i]! * 0.299 + data[i + 1]! * 0.587 + data[i + 2]! * 0.114);
    }
    const avg = totalBrightness / (data.length / 4);
    if (avg > 128) return 'light';
    if (avg < 80) return 'dark';
    return 'neutral';
  }

  function autoTextColor() {
    const contrast = detectContrast();
    if (contrast === 'light') textFontColor = 'black';
    else if (contrast === 'dark') textFontColor = 'white';
  }

  // ── Excel import ──────────────────────────────────────────────────────
  async function importExcelBulk() {
    if (selectedIdx < 0 || selectedIdx >= queue.length) return;
    const templateItem = queue[selectedIdx]!;
    const regions = templateRegions.length > 0
      ? templateRegions
      : region
        ? [{ id: 0, region, label: 'text1' }]
        : [];
    if (regions.length === 0) {
      alert('Please draw a region first to set the template for the text (position and size).');
      return;
    }
    const filePath = await open({
      multiple: false,
      filters: [{ name: 'Excel', extensions: ['xlsx', 'xls', 'csv'] }],
    });
    if (!filePath) return;
    try {
      const rawBytes = await invoke<number[]>('read_file_bytes', { path: filePath as string });
      const data = new Uint8Array(rawBytes);
      const workbook = XLSX.read(data, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) { alert('Excel file has no sheets.'); return; }
      const sheet = workbook.Sheets[sheetName]!;
      const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet);
      if (rows.length === 0) { alert('The Excel file is empty.'); return; }

      const newClones: QueueItem[] = [];
      for (const row of rows) {
        const text = String(row.text ?? row.Text ?? row.TEXT ?? '');
        if (!text) continue;
        const id = String(row.id ?? row.Id ?? row.ID ?? row.Name ?? row.name ?? `clone_${Date.now()}_${newClones.length}`);
        const ops: Operation[] = [];
        for (const tr of regions) {
          const colText = tr.label === 'text1'
            ? text
            : String(row[tr.label] ?? row[tr.label.toUpperCase()] ?? row[tr.label.toLowerCase()] ?? '');
          if (!colText) continue;
          const fontSize = Number(row.fontSize ?? row.font_size ?? row.FontSize ?? textFontSize);
          const fontColor = String(row.fontColor ?? row.font_color ?? row.FontColor ?? textFontColor);
          ops.push({
            id: Date.now() + newClones.length + ops.length,
            mode: 'text',
            region: { ...tr.region },
            text: colText,
            fontSize,
            fontColor,
            fontFamily: String(row.fontFamily ?? row.font_family ?? textFontFamily),
            bold: String(row.bold ?? textBold).toLowerCase() === 'true' || row.bold === 1,
            italic: String(row.italic ?? textItalic).toLowerCase() === 'true' || row.italic === 1,
            bgEnabled: String(row.bgEnabled ?? row.bg_enabled ?? textBgEnabled).toLowerCase() !== 'false',
            bgColor: String(row.bgColor ?? row.bg_color ?? textBgColor),
            bgOpacity: Number(row.bgOpacity ?? row.bg_opacity ?? textBgOpacity),
            borderWidth: Number(row.borderWidth ?? row.border_width ?? textBorderWidth),
            borderColor: String(row.borderColor ?? row.border_color ?? textBorderColor),
            startTime: tempStart,
            endTime: tempEnd,
          });
        }
        if (ops.length === 0) continue;
        newClones.push({
          ...templateItem,
          operations: ops, status: 'idle', progress: 0, error: null, eta: null, speed: null,
          customOutputName: id,
        });
      }
      if (newClones.length === 0) {
        alert('No valid text rows found. Make sure the Excel has a "text" column.');
        return;
      }
      queue = [...queue, ...newClones];
      alert(`Imported ${newClones.length} videos from Excel using ${regions.length} text region(s).`);
    } catch (e) {
      alert('Error reading Excel: ' + e);
    }
  }

  // ── Batch processing ──────────────────────────────────────────────────
  async function processAll() {
    const ready = queue.filter(q => q.operations.length > 0 && q.status !== 'done');
    if (ready.length === 0) return;

    const emptyTextRows = ready
      .filter(q => hasOnlyEmptyTextOps(q.operations))
      .map(q => q.customOutputName ?? q.filename);
    if (emptyTextRows.length > 0) {
      alert(
        `Some videos have no text filled in yet (${emptyTextRows.join(', ')}). ` +
        'Open the Table Editor and enter text for text1/text2 before processing.',
      );
      return;
    }

    isProcessingAll = true;
    for (const q of queue) {
      if (q.operations.length > 0) { q.status = 'queued'; q.progress = 0; q.error = null; }
    }
    queue = [...queue];

    let rafId = 0;
    const scheduleBatch = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => { rafId = 0; touchQueue(); });
    };

    const unlistenProg = await listen<any>('queue-progress', (ev) => {
      const { index, percent, speed, eta } = ev.payload;
      if (index >= 0 && index < queue.length) {
        const item = queue[index]!;
        item.progress = percent ?? 0;
        item.speed = speed ?? null;
        item.eta = eta ?? null;
        scheduleBatch();
      }
    });

    const unlistenStatus = await listen<any>('queue-status', (ev) => {
      const { index, status, error } = ev.payload;
      if (index >= 0 && index < queue.length) {
        const item = queue[index]!;
        if (item.status !== 'processing' && item.status !== 'queued') return;
        item.status = status;
        if (status === 'done') item.progress = 100;
        if (error) item.error = error;
        scheduleBatch();
      }
    });

    const unlistenSummary = await listen<any>('queue-summary', (ev) => {
      batchSummary = ev.payload;
    });

    try {
      const allJobs = queue
        .map((q, originalIndex) => ({ q, originalIndex }))
        .filter(({ q }) => q.operations.length > 0 && q.status !== 'done')
        .map(({ q, originalIndex }) => {
          let outPath = q.path.replace(/(\.[^.]+)$/, `_edited.${exportFormat}`);
          if (q.customOutputName) {
            outPath = q.path.replace(/[^\\/]+(\.[^.]+)$/, `${q.customOutputName}$1`);
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
              text: op.text, font_size: op.fontSize, font_color: op.fontColor ?? 'white',
              font_family: op.fontFamily ?? null, bold: op.bold ?? null, italic: op.italic ?? null,
              bg_enabled: op.bgEnabled ?? null, bg_color: op.bgColor ?? null, bg_opacity: op.bgOpacity ?? null,
              border_width: op.borderWidth ?? null, border_color: op.borderColor ?? null,
            })),
            video_duration: q.duration,
            speed_preset: speedPreset,
          };
        });

      if (allJobs.length === 0) return;

      const BATCH_SIZE = 20;
      for (let offset = 0; offset < allJobs.length; offset += BATCH_SIZE) {
        if (!isProcessingAll) break;
        const batch = allJobs.slice(offset, offset + BATCH_SIZE);
        await invoke('process_queue', { jobs: batch });
      }
    } catch (e) {
      alert('Queue error: ' + e);
    } finally {
      if (rafId) cancelAnimationFrame(rafId);
      unlistenProg();
      unlistenStatus();
      unlistenSummary();
      isProcessingAll = false;
    }
  }

  async function cancelAll() {
    await invoke('cancel_all_jobs');
    for (const q of queue) { if (q.status === 'processing' || q.status === 'queued') q.status = 'idle'; }
    touchQueue();
    isProcessingAll = false;
  }

  function applyToAll() {
    if (selectedIdx < 0 || selectedIdx >= queue.length) return;
    const sourceOps = queue[selectedIdx]!.operations;
    if (sourceOps.length === 0) { alert('No operations to apply.'); return; }
    if (!confirm(`Apply ${sourceOps.length} operation(s) to all ${queue.length} video(s)?`)) return;
    for (let i = 0; i < queue.length; i++) {
      if (i === selectedIdx) continue;
      queue[i]!.operations = sourceOps.map(op => ({
        ...op,
        id: Date.now() + Math.random(),
        region: op.region ? { ...op.region } : null,
      }));
    }
    touchQueue();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<main class="h-screen flex flex-col select-none overflow-hidden"
  style="background:var(--bg-app);color:var(--text-primary)"
  ondragenter={onDragEnter} ondragover={onDragOver} ondragleave={onDragLeave} ondrop={onDrop}>

  <Header
    {queue}
    bind:isProcessingAll
    {batchSummary}
    bind:exportFormat
    bind:speedPreset
    canUndo={historyIndex > 0}
    canRedo={historyIndex < history.length - 1}
    hasSelected={!!selected}
    onUndo={undo}
    onRedo={redo}
    onAddVideo={addVideo}
    onProcessAll={processAll}
    onCancelAll={cancelAll}
    onShowShortcuts={() => showShortcuts = !showShortcuts}
  />

  <BatchProgressBar {queue} {isProcessingAll} />

  <div class="flex-1 flex overflow-hidden min-h-0">
    <QueueSidebar
      bind:queue
      bind:selectedIdx
      {templateIdx}
      onAddVideo={addVideo}
      onSelectItem={selectQueueItem}
      onRemoveItem={removeQueueItem}
    />

    <!-- Preview + toolbar -->
    <div class="flex-1 flex flex-col min-w-0">
      <div class="cap-preview flex-1">
        {#if selected}
          <div class="relative inline-block cap-animate-in" style="max-width:100%;max-height:100%">
            <!-- svelte-ignore a11y_media_has_caption -->
            <video bind:this={videoEl} src={selected.src} controls
              class="max-h-[calc(100vh-140px)] max-w-full"
              style="display:block;object-fit:contain;border-radius:4px"
              onloadedmetadata={() => { region = null; setTimeout(fitCanvas, 50); }}></video>

            {#if selected}
              {#each selected.operations as op, opIdx (op.id)}
                {@const s = regionToScreen(op.region)}
                {#if s}
                  {#if op.mode === 'blur'}
                    <div class="absolute pointer-events-none"
                      style="left:{s.x}px;top:{s.y}px;width:{s.w}px;height:{s.h}px;backdrop-filter:blur({(op.blurStrength ?? 20) * s.sy}px);-webkit-backdrop-filter:blur({(op.blurStrength ?? 20) * s.sy}px)"></div>
                  {:else if op.mode === 'text' && op.text}
                    {@const bgOn = op.bgEnabled ?? true}
                    {@const fontSize = Math.max(1, (op.fontSize ?? 24) * s.sy)}
                    {@const isHovered = hoveredOpIdx === opIdx}
                    {@const isActive = draggingOpIdx === opIdx || resizingOpIdx === opIdx}
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <div class="absolute {isActive ? 'pointer-events-auto cursor-grabbing' : isHovered ? 'pointer-events-auto cursor-grab' : 'pointer-events-none'}"
                      style="left:{s.x}px;top:{s.y}px;width:{s.w}px;height:{s.h}px;{(isHovered && !isActive) ? 'outline:1.5px dashed rgba(0,240,234,0.7);outline-offset:2px;' : ''}{isActive ? 'outline:2px solid rgba(0,240,234,0.9);outline-offset:2px;' : ''}">
                      <div style="color:{op.fontColor ?? 'white'};font-size:{fontSize}px;font-family:{cssFontFamily(op.fontFamily)};font-weight:{op.bold ? 700 : 400};font-style:{op.italic ? 'italic' : 'normal'};background:{bgOn ? (op.bgColor ?? 'black') : 'transparent'};opacity:{bgOn ? (op.bgOpacity ?? 0.65) : 1};padding:{bgOn ? Math.max(2,4*s.sy) : 0}px {bgOn ? Math.max(4,8*s.sy) : 0}px;border-radius:{bgOn ? Math.max(3,6*s.sy) : 0}px;white-space:pre-wrap">{op.text}</div>
                      {#if isHovered || isActive}
                        {@const hs = 6}
                        <div class="absolute pointer-events-none" style="left:-{hs/2}px;top:-{hs/2}px;width:{hs}px;height:{hs}px;background:#00f0ea;border:1px solid white;border-radius:1px;"></div>
                        <div class="absolute pointer-events-none" style="right:-{hs/2}px;top:-{hs/2}px;width:{hs}px;height:{hs}px;background:#00f0ea;border:1px solid white;border-radius:1px;"></div>
                        <div class="absolute pointer-events-none" style="left:-{hs/2}px;bottom:-{hs/2}px;width:{hs}px;height:{hs}px;background:#00f0ea;border:1px solid white;border-radius:1px;"></div>
                        <div class="absolute pointer-events-none" style="right:-{hs/2}px;bottom:-{hs/2}px;width:{hs}px;height:{hs}px;background:#00f0ea;border:1px solid white;border-radius:1px;"></div>
                      {/if}
                    </div>
                  {/if}
                {/if}
              {/each}
            {/if}

            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <canvas bind:this={canvas} class="absolute top-0 left-0" style="cursor:crosshair"
              onmousedown={onCanvasMouseDown} onmousemove={onCanvasMouseMove}
              onmouseup={onCanvasUp} onmouseleave={onCanvasUp}></canvas>
          </div>
        {:else}
          <div class="cap-preview-empty cap-animate-in">
            <div class="cap-preview-empty-icon">
              <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/>
              </svg>
            </div>
            <p class="text-sm font-semibold mb-1" style="color:var(--text-secondary)">Arrastra videos aqu&iacute;</p>
            <p class="text-xs" style="color:var(--text-dim)">MP4, MOV, AVI, MKV, WebM</p>
            <button onclick={addVideo} class="cap-btn-secondary mt-4">Importar medios</button>
          </div>
        {/if}
      </div>

      <ToolBar bind:activeTool visible={!!selected && sidebarMode === 'logo'} />
    </div>

    <!-- Properties panel — right -->
    {#if selected}
      <aside class="cap-sidebar cap-sidebar-right overflow-y-auto">
        <div class="cap-section !pb-3">
          <div class="cap-mode-tabs">
            <button onclick={() => sidebarMode = 'logo'} class="cap-mode-tab {sidebarMode === 'logo' ? 'active-logo' : ''}">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9.53 16.122a3 3 0 00-5.78 1.128 2.25 2.25 0 01-2.4 2.245 4.5 4.5 0 008.4-2.245c0-.399-.078-.78-.22-1.128zm0 0a15.364 15.364 0 018.466-6.282 3 3 0 00-4.242-4.243 15.364 15.364 0 00-6.282 8.466 3 3 0 004.242 4.243"/></svg>
              Quitar logo
            </button>
            <button onclick={() => sidebarMode = 'batch'} class="cap-mode-tab {sidebarMode === 'batch' ? 'active-batch' : ''}">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 01-1.125-1.125M3.375 19.5h7.5c.621 0 1.125-.504 1.125-1.125m-9.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-13.5V5.625m0 0h-7.5m7.5 0v1.5c0 .621-.504 1.125-1.125 1.125M3.375 8.25c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m17.25-3.75h-7.5"/></svg>
              Texto en lote
            </button>
          </div>
        </div>

        <div class="cap-section">
          <div class="cap-section-title">
            Regi&oacute;n &middot; <span class="normal-case tracking-normal font-normal" style="color:var(--text-secondary)">{selected.filename}</span>
          </div>

          {#if region}
            <div class="grid grid-cols-2 gap-2 mb-3">
              {#each ([['X','x'],['Y','y'],['W','w'],['H','h']] as const) as [label, key]}
                <label>
                  <span class="cap-input-label">{label}</span>
                  <input type="number" value={Math.round(region[key])}
                    onchange={(e) => { region = { ...region!, [key]: parseInt((e.target as HTMLInputElement).value) || 0 }; }}
                    class="cap-input font-mono text-[11px]" />
                </label>
              {/each}
            </div>

            {#if sidebarMode === 'logo'}
              <div class="mb-3">
                <label class="flex items-center gap-2 text-[10px]" style="color:var(--text-muted)">
                  Intensidad blur
                  <input type="range" min="2" max="60" bind:value={blurStrength} class="flex-1" />
                  <span class="font-mono text-xs w-6 text-right" style="color:var(--accent)">{blurStrength}</span>
                </label>
              </div>
            {/if}

            <div class="mb-3 space-y-2">
              {#if sidebarMode === 'logo'}
                <label>
                  <span class="cap-input-label">Contenido de texto</span>
                  <input type="text" bind:value={textInput} placeholder="Escribe aqu&iacute;..." class="cap-input" />
                </label>
              {:else}
                <div class="cap-card cap-card-batch text-[10px] leading-relaxed" style="color:rgba(168,85,247,0.85)">
                  La regi&oacute;n dibujada define posici&oacute;n y tama&ntilde;o. El texto se cargar&aacute; desde Excel.
                </div>
              {/if}

              <StyleEditor
                bind:fontFamily={textFontFamily}
                bind:bold={textBold}
                bind:italic={textItalic}
                bind:fontSize={textFontSize}
                bind:fontColor={textFontColor}
                bind:bgEnabled={textBgEnabled}
                bind:bgColor={textBgColor}
                bind:bgOpacity={textBgOpacity}
                bind:borderWidth={textBorderWidth}
                bind:borderColor={textBorderColor}
              />
            </div>

            <PresetManager
              bind:this={presetManager}
              bind:presets
              currentStyle={() => ({
                name: '', fontFamily: textFontFamily, bold: textBold, italic: textItalic,
                fontSize: textFontSize, fontColor: textFontColor, bgEnabled: textBgEnabled,
                bgColor: textBgColor, bgOpacity: textBgOpacity, borderWidth: textBorderWidth,
                borderColor: textBorderColor,
              })}
              onApply={(p) => {
                textFontFamily = p.fontFamily; textBold = p.bold; textItalic = p.italic;
                textFontSize = p.fontSize; textFontColor = p.fontColor; textBgEnabled = p.bgEnabled;
                textBgColor = p.bgColor; textBgOpacity = p.bgOpacity; textBorderWidth = p.borderWidth;
                textBorderColor = p.borderColor;
              }}
            />

            {#if sidebarMode === 'logo'}
              <div class="grid grid-cols-2 gap-2 mb-3">
                <label>
                  <span class="cap-input-label">Inicio (s)</span>
                  <input type="number" bind:value={tempStart} placeholder="0" class="cap-input font-mono text-[11px]" />
                </label>
                <label>
                  <span class="cap-input-label">Fin (s)</span>
                  <input type="number" bind:value={tempEnd} placeholder="final" class="cap-input font-mono text-[11px]" />
                </label>
              </div>
            {/if}
            <div class="mb-2">
              <button onclick={() => addOperation(activeTool)}
                class="cap-btn-apply {activeTool === 'blur' ? 'cap-btn-apply-blur' : activeTool === 'crop' ? 'cap-btn-apply-crop' : activeTool === 'delogo' ? 'cap-btn-apply-delogo' : 'cap-btn-apply-text'}">
                Aplicar {activeTool === 'blur' ? 'Desenfoque' : activeTool === 'crop' ? 'Recorte' : activeTool === 'delogo' ? 'Remover Logo' : 'Texto'}
              </button>
            </div>
            <button onclick={() => { region = null; drawRegion(); }} class="text-[10px] mb-3 hover:underline" style="color:var(--text-muted)">Cancelar selecci&oacute;n</button>
            <div class="mb-3">
              <div class="cap-input-label mb-1.5">Posici&oacute;n autom&aacute;tica</div>
              <div class="grid grid-cols-5 gap-1">
                <button onclick={() => autoPositionText('top-left')} class="cap-btn-icon !w-full" title="Arriba izq">&#8598;</button>
                <button onclick={() => autoPositionText('center')} class="cap-btn-icon !w-full" title="Centro">&#8853;</button>
                <button onclick={() => autoPositionText('top-right')} class="cap-btn-icon !w-full" title="Arriba der">&#8599;</button>
                <button onclick={() => autoPositionText('bottom-left')} class="cap-btn-icon !w-full" title="Abajo izq">&#8601;</button>
                <button onclick={() => autoPositionText('bottom-right')} class="cap-btn-icon !w-full" title="Abajo der">&#8600;</button>
              </div>
              <button onclick={autoTextColor} class="cap-btn-secondary w-full mt-1.5 text-[10px] !py-1.5">
                Color autom&aacute;tico (contraste)
              </button>
            </div>
          {:else}
            <div class="text-[11px] mb-4 leading-relaxed cap-card cap-card-info" style="color:var(--text-secondary)">
              Dibuja un rect&aacute;ngulo sobre el video para seleccionar el &aacute;rea. Ajusta con los handles o los valores num&eacute;ricos.
            </div>
          {/if}

          {#if sidebarMode === 'batch'}
            <BatchPanel
              {selectedIdx}
              bind:templateIdx
              bind:templateRegions
              bind:nextRegionLabel
              {region}
              bind:batchFindText
              bind:batchReplaceText
              bind:batchFindScope
              onAddTemplateRegion={addTemplateRegion}
              onRemoveTemplateRegion={removeTemplateRegion}
              onSetTemplate={setTemplate}
              onImportExcel={importExcelBulk}
              onOpenTableEditor={() => showTableEditor = true}
              onBatchFindReplace={batchFindReplace}
            />
          {/if}
        </div>

        <LayerList
          bind:operations={selected.operations}
          onRemove={removeOp}
          onMove={moveOp}
          onDuplicate={duplicateOp}
          onEditRegion={editOpRegion}
          onApplyStyle={applyStyleToOp}
          onClearOps={clearOps}
          onStyleTextOp={applyStyleToOp}
        />
      </aside>
    {/if}
  </div>

  <DragOverlay {isDragging} />

  <ShortcutsModal bind:open={showShortcuts} />

  <TableEditor
    bind:open={showTableEditor}
    bind:queue
    {selectedIdx}
    {templateRegions}
    {region}
    {textFontSize}
    {textFontColor}
    {textFontFamily}
    {textBold}
    {textItalic}
    {textBgEnabled}
    {textBgColor}
    {textBgOpacity}
    {textBorderWidth}
    {textBorderColor}
    onSelectItem={selectQueueItem}
  />
</main>

<svelte:window onkeydown={(e) => {
  if (showShortcuts && e.key === 'Escape') { showShortcuts = false; return; }
  if (showTableEditor && e.key === 'Escape') { showTableEditor = false; return; }
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'o') { e.preventDefault(); addVideo(); }
  if (e.key === '?' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); showShortcuts = !showShortcuts; }
}} />

<style>
  :global(body) { margin: 0; overflow: hidden; }
</style>
