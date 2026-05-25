<script lang="ts">
  import { open } from '@tauri-apps/plugin-dialog';
  import { invoke, convertFileSrc } from '@tauri-apps/api/core';
  import { listen } from '@tauri-apps/api/event';
  import * as XLSX from 'xlsx';
  import { fmtTime } from '$lib/utils';

  type QueueStatus = 'idle' | 'queued' | 'processing' | 'done' | 'error';
  type Region = { x: number; y: number; w: number; h: number };
  type Operation = {
    id: number;
    mode: string;
    region: Region | null;
    blurStrength?: number;
    startTime?: number | null;
    endTime?: number | null;
    text?: string;
    fontSize?: number;
    fontColor?: string;
  };
  const MODE_META: Record<string, { label: string; color: string }> = {
    blur: { label: 'Blur', color: 'text-blue-400' },
    crop: { label: 'Crop', color: 'text-amber-400' },
    text: { label: 'Text', color: 'text-purple-400' },
  };
  type QueueItem = {
    path: string;
    src: string;
    filename: string;
    width: number;
    height: number;
    duration: number;
    operations: Operation[];
    status: QueueStatus;
    progress: number;
    eta: number | null;
    speed: number | null;
    error: string | null;
    customOutputName?: string;
  };

  function touchQueue() { queue = [...queue]; }
  function updateOps(fn: (ops: Operation[]) => Operation[]) {
    if (selectedIdx < 0 || selectedIdx >= queue.length) return;
    const item = queue[selectedIdx]!;
    item.operations = fn(item.operations);
    touchQueue();
  }

  let queue = $state<QueueItem[]>([]);
  let selectedIdx = $state<number>(-1);
  let isProcessingAll = $state(false);
  let speedPreset = $state('ultrafast');
  let sidebarMode = $state<'logo' | 'batch'>('logo');

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

    ctx.fillStyle = 'rgba(6, 182, 212, 0.15)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(6, 182, 212, 0.85)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);

    const ms = Math.min(12, w / 3, h / 3);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5;
    for (const [cx, cy, dx1, dy1, dx2, dy2] of [
      [x, y, ms, 0, 0, ms], [x + w, y, -ms, 0, 0, ms],
      [x, y + h, ms, 0, 0, -ms], [x + w, y + h, -ms, 0, 0, -ms],
    ] as [number, number, number, number, number, number][]) {
      ctx.beginPath(); ctx.moveTo(cx + dx1, cy + dy1); ctx.lineTo(cx, cy); ctx.lineTo(cx + dx2, cy + dy2); ctx.stroke();
    }

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

  function contentRect() {
    if (!videoEl) return null;
    const br = videoEl.getBoundingClientRect();
    const vr = videoEl.videoWidth / videoEl.videoHeight;
    const cr = br.width / br.height;
    let dw: number, dh: number, ox: number, oy: number;
    if (vr > cr) { dw = br.width; dh = br.width / vr; ox = 0; oy = (br.height - dh) / 2; }
    else { dh = br.height; dw = br.height * vr; ox = (br.width - dw) / 2; oy = 0; }
    return { dw, dh, ox, oy, br };
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

  function onCanvasMouseMove(e: MouseEvent) {
    if (isDrawing || resizing) { onCanvasMove(e); return; }
    const h = hitTestHandle(e.clientX, e.clientY);
    if (h && canvas) canvas.style.cursor = CURSORS[h] ?? 'crosshair';
    else if (canvas) canvas.style.cursor = 'crosshair';
  }

  function onCanvasMouseDown(e: MouseEvent) {
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

  async function addVideo() {
    const sel = await open({
      multiple: true,
      filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm', 'flv'] }],
    });
    if (!sel) return;
    const paths = Array.isArray(sel) ? sel : [sel];
    for (const path of paths) {
      if (queue.some(q => q.path === path)) continue;
      const filename = path.split(/[/\\]/).pop() ?? path;
      const src = convertFileSrc(path);
      let width = 0, height = 0, duration = 0;
      try {
        const info: any = await invoke('get_video_info', { path });
        duration = info.duration ?? 0;
        const raw: string = info.raw_info ?? '';
        const resMatch = raw.match(/(\d{2,5})x(\d{2,5})/);
        if (resMatch) { width = parseInt(resMatch[1]!); height = parseInt(resMatch[2]!); }
      } catch {}
      queue = [...queue, {
        path, src, filename, width, height, duration,
        operations: [], status: 'idle', progress: 0, eta: null, speed: null, error: null,
      }];
    }
    if (selectedIdx < 0 && queue.length > 0) selectedIdx = 0;
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

  function addOperation(mode: string) {
    if (!region || selectedIdx < 0) return;
    const op: Operation = {
      id: Date.now(), mode, region: { ...region },
      blurStrength: mode === 'blur' ? blurStrength : undefined,
      startTime: tempStart, endTime: tempEnd,
      text: mode === 'text' ? textInput : undefined,
      fontSize: mode === 'text' ? textFontSize : undefined,
      fontColor: mode === 'text' ? textFontColor : undefined,
    };
    updateOps(ops => [...ops, op]);
    region = null;
    tempStart = null;
    tempEnd = null;
    drawRegion();
  }

  async function importExcelBulk() {
    if (selectedIdx < 0 || selectedIdx >= queue.length) return;
    const templateItem = queue[selectedIdx]!;
    
    if (!region) {
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

      if (rows.length === 0) {
        alert('The Excel file is empty.');
        return;
      }

      const newClones: QueueItem[] = [];
      for (const row of rows) {
        const text = String(row.text ?? row.Text ?? row.TEXT ?? '');
        if (!text) continue;

        const id = String(row.id ?? row.Id ?? row.ID ?? row.Name ?? row.name ?? `clone_${Date.now()}_${newClones.length}`);

        const w = region.w;
        const h = region.h;
        const x = region.x;
        const y = region.y;
        
        const fontSize = Number(row.fontSize ?? row.font_size ?? row.FontSize ?? textFontSize);
        const fontColor = String(row.fontColor ?? row.font_color ?? row.FontColor ?? textFontColor);

        const newOp: Operation = {
          id: Date.now() + newClones.length,
          mode: 'text',
          region: { x, y, w, h },
          text,
          fontSize,
          fontColor,
          startTime: tempStart,
          endTime: tempEnd,
        };

        const clone: QueueItem = {
          ...templateItem,
          operations: [newOp],
          status: 'idle',
          progress: 0,
          error: null,
          eta: null,
          speed: null,
          customOutputName: id,
        };
        newClones.push(clone);
      }

      if (newClones.length === 0) {
        alert('No valid text rows found. Make sure the Excel has a "text" column.');
        return;
      }

      queue = [...queue, ...newClones];
      alert(`Imported ${newClones.length} videos from Excel using the template.`);
      
      region = null;
      drawRegion();
    } catch (e) {
      alert('Error reading Excel: ' + e);
    }
  }

  function removeOp(opIdx: number) {
    updateOps(ops => ops.filter((_, i) => i !== opIdx));
  }

  function clearOps() {
    updateOps(() => []);
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

  async function processAll() {
    const ready = queue.filter(q => q.operations.length > 0 && q.status !== 'done');
    if (ready.length === 0) return;
    isProcessingAll = true;

    for (const q of queue) {
      if (q.operations.length > 0) { q.status = 'queued'; q.progress = 0; q.error = null; }
    }
    queue = [...queue];

    const unlistenProg = await listen<any>('queue-progress', (ev) => {
      const { index, percent, speed, eta } = ev.payload;
      if (index >= 0 && index < queue.length) {
        const item = queue[index]!;
        item.progress = percent ?? 0;
        item.speed = speed ?? null;
        item.eta = eta ?? null;
        touchQueue();
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
        touchQueue();
      }
    });

    try {
      const jobs = queue
        .map((q, originalIndex) => ({ q, originalIndex }))
        .filter(({ q }) => q.operations.length > 0)
        .map(({ q, originalIndex }) => {
          let outPath = q.path.replace(/(\.[^.]+)$/, '_no_logo$1');
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
            })),
            video_duration: q.duration,
            speed_preset: speedPreset,
          };
        });
      await invoke('process_queue', { jobs });
    } catch (e) {
      alert('Queue error: ' + e);
    } finally {
      unlistenProg();
      unlistenStatus();
      isProcessingAll = false;
    }
  }

  async function cancelAll() {
    await invoke('cancel_all_jobs');
    for (const q of queue) { if (q.status === 'processing' || q.status === 'queued') q.status = 'idle'; }
    touchQueue();
    isProcessingAll = false;
  }
</script>

<main class="h-screen flex flex-col bg-zinc-950 text-zinc-100 select-none overflow-hidden">
  <!-- Header -->
  <header class="h-14 px-4 border-b border-zinc-800 flex items-center gap-3 bg-zinc-950 shrink-0 z-10">
    <div class="flex items-center gap-2">
      <div class="h-7 w-7 rounded-lg bg-gradient-to-br from-cyan-500 to-violet-600 flex items-center justify-center">
        <svg class="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/>
        </svg>
      </div>
      <span class="font-bold text-sm tracking-tight">Beru</span>
      <span class="text-[9px] text-zinc-500 bg-zinc-800/60 px-1.5 py-0.5 rounded font-mono">logo remover</span>
    </div>
    <div class="ml-3 flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[9px] font-medium text-emerald-400">
      <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> LOCAL
    </div>
    <div class="flex-1"></div>
    <label class="text-[10px] text-zinc-500 flex items-center gap-1">
      Speed:
      <select bind:value={speedPreset} class="bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-[11px] text-zinc-200">
        <option value="ultrafast">ultrafast</option>
        <option value="superfast">superfast</option>
        <option value="veryfast">veryfast</option>
        <option value="fast">fast</option>
        <option value="medium">medium</option>
      </select>
    </label>
    <button onclick={addVideo} class="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded text-xs font-medium">
      + Add videos
    </button>
    {#if isProcessingAll}
      <button onclick={cancelAll} class="px-3 py-1.5 bg-red-700 hover:bg-red-600 rounded text-xs font-medium">Cancel all</button>
    {:else}
      <button onclick={processAll} disabled={!queue.some(q => q.operations.length > 0)}
        class="px-4 py-1.5 bg-emerald-700 hover:bg-emerald-600 disabled:bg-zinc-800 disabled:text-zinc-500 rounded text-xs font-medium">
        Process {queue.filter(q => q.operations.length > 0).length} video(s)
      </button>
    {/if}
  </header>

  <div class="flex-1 flex overflow-hidden">
    <!-- Queue sidebar -->
    <aside class="w-60 border-r border-zinc-800 flex flex-col bg-zinc-950 shrink-0">
      <div class="px-3 py-2 text-[10px] font-medium text-zinc-500 uppercase tracking-wider border-b border-zinc-800/60">
        Queue ({queue.length})
      </div>
      <div class="flex-1 overflow-y-auto">
        {#if queue.length === 0}
          <div class="p-4 text-center text-zinc-600 text-xs">
            <div class="text-3xl mb-2 opacity-30">+</div>
            Click "Add videos"
          </div>
        {:else}
          {#each queue as item, i}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="flex items-start gap-2 px-2.5 py-2 border-b border-zinc-800/40 cursor-pointer transition-colors
                   {i === selectedIdx ? 'bg-zinc-800/70' : 'hover:bg-zinc-800/30'}"
              onclick={() => selectQueueItem(i)}
              onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') selectQueueItem(i); }}>
              <div class="w-14 h-9 rounded overflow-hidden bg-zinc-900 shrink-0 relative">
                <!-- svelte-ignore a11y_media_has_caption -->
                <video src={item.src} class="w-full h-full object-cover" muted preload="metadata"></video>
                {#if item.status === 'done'}
                  <div class="absolute inset-0 bg-emerald-900/60 flex items-center justify-center text-[9px] font-bold text-emerald-300">OK</div>
                {:else if item.status === 'processing'}
                  <div class="absolute bottom-0 left-0 right-0 h-1 bg-zinc-700"><div class="h-full bg-emerald-500 transition-all" style="width:{item.progress}%"></div></div>
                {:else if item.status === 'error'}
                  <div class="absolute inset-0 bg-red-900/60 flex items-center justify-center text-[9px] text-red-300">ERR</div>
                {/if}
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-1.5 text-[10px] truncate {i === selectedIdx ? 'text-zinc-100' : 'text-zinc-300'}">
                  {#if item.customOutputName}
                    <span class="px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-[9px] font-medium tracking-wide">BATCH</span>
                    <span class="truncate">{item.customOutputName}</span>
                  {:else}
                    <span class="truncate">{item.filename}</span>
                  {/if}
                </div>
                <div class="text-[9px] text-zinc-500">{item.width}x{item.height} &middot; {fmtTime(item.duration)}</div>
                <div class="text-[9px] text-zinc-500">
                  {item.operations.length} op{item.operations.length !== 1 ? 's' : ''}
                  {#if item.status === 'processing' && item.eta != null}
                    <span class="text-emerald-400 ml-1">{Math.round(item.eta)}s</span>
                  {/if}
                  {#if item.status === 'done'}<span class="text-emerald-400 ml-1">Done</span>{/if}
                  {#if item.error}<span class="text-red-400 ml-1 truncate block">{item.error}</span>{/if}
                </div>
              </div>
              <button onclick={(e) => { e.stopPropagation(); removeQueueItem(i); }} class="text-zinc-600 hover:text-red-400 text-xs shrink-0 mt-0.5" disabled={item.status === 'processing'}>&times;</button>
            </div>
          {/each}
        {/if}
      </div>
    </aside>

    <!-- Video preview -->
    <div class="flex-1 flex items-center justify-center bg-black relative overflow-hidden">
      {#if selected}
        <div class="relative inline-block" style="max-width:100%;max-height:100%">
          <!-- svelte-ignore a11y_media_has_caption -->
          <video bind:this={videoEl} src={selected.src} controls
            class="max-h-[calc(100vh-80px)] max-w-full rounded shadow-2xl"
            style="display:block;object-fit:contain"
            onloadedmetadata={() => { region = null; setTimeout(fitCanvas, 50); }}></video>
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <canvas bind:this={canvas} class="absolute top-0 left-0" style="cursor:crosshair"
            onmousedown={onCanvasMouseDown} onmousemove={onCanvasMouseMove}
            onmouseup={onCanvasUp} onmouseleave={onCanvasUp}></canvas>
        </div>
      {:else}
        <div class="text-center text-zinc-600">
          <div class="text-5xl mb-3 opacity-30">+</div>
          <p class="text-sm">Add videos to the queue</p>
          <p class="text-[10px] mt-1 text-zinc-700">Select a video from the queue to edit</p>
        </div>
      {/if}
    </div>

    <!-- Right sidebar -->
    {#if selected}
      <aside class="w-72 border-l border-zinc-800 flex flex-col bg-zinc-950 shrink-0 overflow-y-auto">
        <div class="p-3 pb-0">
          <div class="flex p-1 bg-zinc-900/50 rounded-lg border border-zinc-800/80">
            <button onclick={() => sidebarMode = 'logo'} class="flex-1 py-1.5 text-xs font-medium rounded-md transition-all duration-200 {sidebarMode === 'logo' ? 'text-cyan-50 bg-cyan-900/40 shadow-sm border border-cyan-500/20' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'}">
              Logo Remove
            </button>
            <button onclick={() => sidebarMode = 'batch'} class="flex-1 py-1.5 text-xs font-medium rounded-md transition-all duration-200 {sidebarMode === 'batch' ? 'text-indigo-50 bg-indigo-900/40 shadow-sm border border-indigo-500/20' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'}">
              Batch Text
            </button>
          </div>
        </div>

        <div class="p-3 flex flex-col flex-1">
          <div class="text-[10px] font-medium text-zinc-500 uppercase tracking-wider mb-2">
            Region &middot; <span class="text-zinc-300 normal-case">{selected.filename}</span>
          </div>

          {#if region}
            <div class="grid grid-cols-2 gap-1.5 mb-3">
              {#each ([['X','x'],['Y','y'],['W','w'],['H','h']] as const) as [label, key]}
                <label class="flex items-center gap-1 text-[10px] text-zinc-500">
                  <span class="w-3 shrink-0">{label}</span>
                  <input type="number" value={Math.round(region[key])}
                    onchange={(e) => { region = { ...region!, [key]: parseInt((e.target as HTMLInputElement).value) || 0 }; }}
                    class="w-full bg-zinc-900 border border-zinc-700 rounded px-1.5 py-1 text-xs text-zinc-100 font-mono" />
                </label>
              {/each}
            </div>

            {#if sidebarMode === 'logo'}
              <div class="mb-3">
                <label class="flex items-center gap-2 text-[10px] text-zinc-500">
                  Blur
                  <input type="range" min="2" max="60" bind:value={blurStrength} class="flex-1 accent-cyan-500" />
                  <span class="font-mono text-xs w-6 text-right">{blurStrength}</span>
                </label>
              </div>
            {/if}

            <div class="mb-3 space-y-1.5">
              {#if sidebarMode === 'logo'}
                <label class="flex flex-col text-[10px] text-zinc-500 group">
                  Text content
                  <input type="text" bind:value={textInput} placeholder="Enter text..." class="mt-1 bg-zinc-900/80 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-100 focus:outline-none focus:ring-1 focus:ring-purple-500/50 focus:border-purple-500/50 transition-all" />
                </label>
              {:else}
                <div class="flex items-start gap-2 bg-indigo-950/30 p-2.5 rounded-lg border border-indigo-500/20 mb-3 shadow-inner">
                  <svg class="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                  <div class="text-[10px] text-indigo-200/80 leading-relaxed">
                    The drawn region acts as the template for position and size. Text content will be loaded dynamically from your Excel file.
                  </div>
                </div>
              {/if}
              <div class="grid grid-cols-2 gap-2">
                <label class="flex flex-col text-[10px] text-zinc-500">
                  Font size
                  <div class="relative mt-1">
                    <span class="absolute inset-y-0 left-0 flex items-center pl-2 text-zinc-600">
                      <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16m-7 6h7"></path></svg>
                    </span>
                    <input type="number" bind:value={textFontSize} min="8" max="200" class="w-full bg-zinc-900/80 border border-zinc-700 rounded pl-6 pr-2 py-1.5 text-xs text-zinc-100 focus:outline-none focus:ring-1 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all" />
                  </div>
                </label>
                <label class="flex flex-col text-[10px] text-zinc-500">
                  Color
                  <div class="relative mt-1">
                    <span class="absolute inset-y-0 left-0 flex items-center pl-2 text-zinc-600">
                      <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"></path></svg>
                    </span>
                    <input type="text" bind:value={textFontColor} placeholder="white" class="w-full bg-zinc-900/80 border border-zinc-700 rounded pl-6 pr-2 py-1.5 text-xs text-zinc-100 focus:outline-none focus:ring-1 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all" />
                  </div>
                </label>
              </div>
            </div>

            {#if sidebarMode === 'logo'}
              <div class="grid grid-cols-2 gap-1.5 mb-3">
                <label class="flex flex-col text-[10px] text-zinc-500">
                  Start (s)
                  <input type="number" bind:value={tempStart} placeholder="0" class="bg-zinc-900 border border-zinc-700 rounded px-1.5 py-1 text-xs text-zinc-100" />
                </label>
                <label class="flex flex-col text-[10px] text-zinc-500">
                  End (s)
                  <input type="number" bind:value={tempEnd} placeholder="end" class="bg-zinc-900 border border-zinc-700 rounded px-1.5 py-1 text-xs text-zinc-100" />
                </label>
              </div>

              <div class="grid grid-cols-3 gap-1.5 mb-2">
                <button onclick={() => addOperation('blur')} class="bg-blue-700 hover:bg-blue-600 py-1.5 rounded text-xs font-medium">Blur</button>
                <button onclick={() => addOperation('crop')} class="bg-amber-700 hover:bg-amber-600 py-1.5 rounded text-xs font-medium">Crop</button>
                <button onclick={() => addOperation('text')} class="bg-purple-700 hover:bg-purple-600 py-1.5 rounded text-xs font-medium">Text</button>
              </div>
            {/if}
            <button onclick={() => { region = null; drawRegion(); }} class="text-[10px] text-zinc-500 hover:text-zinc-300 mb-3">Cancel selection</button>
          {:else}
            <div class="text-[11px] text-zinc-600 mb-4 leading-relaxed">
              Draw a rectangle on the video to select the area. Adjust with handles or numeric inputs.
            </div>
          {/if}

          {#if sidebarMode === 'batch'}
            <button onclick={importExcelBulk}
              class="w-full mb-3 py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 shadow-lg shadow-indigo-500/25 border border-indigo-400/30 rounded-lg text-xs font-semibold text-white flex items-center justify-center gap-2 transform hover:scale-[1.02] active:scale-95 transition-all duration-200">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/>
              </svg>
              Import text from Excel
            </button>
          {/if}

          <div class="text-[10px] font-medium text-zinc-500 uppercase tracking-wider mb-1.5 mt-auto">
            Operations ({selected.operations.length})
          </div>
        {#if selected.operations.length === 0}
          <div class="text-[11px] text-zinc-700">None yet</div>
        {:else}
          <div class="space-y-1">
            {#each selected.operations as op, oi}
              <div class="flex items-center gap-1.5 bg-zinc-900 px-2 py-1.5 rounded text-[11px] group">
                <span class="uppercase font-medium w-10 shrink-0 {MODE_META[op.mode]?.color ?? 'text-zinc-400'}">
                  {MODE_META[op.mode]?.label ?? op.mode}
                </span>
                {#if op.mode === 'text' && op.text}
                  <span class="text-zinc-300 text-[10px] flex-1 truncate">"{op.text}"</span>
                {:else if op.region}
                  <span class="font-mono text-zinc-500 text-[10px] flex-1 truncate">
                    {Math.round(op.region.x)},{Math.round(op.region.y)} {Math.round(op.region.w)}x{Math.round(op.region.h)}
                  </span>
                {/if}
                {#if op.startTime || op.endTime}
                  <span class="text-amber-500 text-[10px]">{op.startTime ?? 0}s-{op.endTime ?? 'end'}</span>
                {/if}
                <button onclick={() => editOpRegion(oi)}
                  class="text-zinc-600 hover:text-blue-400 text-[10px] opacity-0 group-hover:opacity-100 transition-opacity" title="Edit region">E</button>
                <button onclick={() => removeOp(oi)} class="text-zinc-600 hover:text-red-400 text-xs" title="Remove">&times;</button>
              </div>
            {/each}
            <button onclick={clearOps} class="text-[10px] text-red-500 hover:text-red-400 mt-1">Clear all</button>
          </div>
        {/if}
        </div>
      </aside>
    {/if}
  </div>
</main>

<style>
  :global(body) { margin: 0; overflow: hidden; }
  input[type="range"] { accent-color: #06b6d4; }
</style>
