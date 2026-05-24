<script lang="ts">
  import { open } from '@tauri-apps/plugin-dialog';
  import { invoke, convertFileSrc } from '@tauri-apps/api/core';
  import { listen } from '@tauri-apps/api/event';

  let videoSrc = $state<string | null>(null);     // for <video> preview (object url or file://)
  let videoPath = $state<string | null>(null);    // real absolute path for Rust
  let videoElement = $state<HTMLVideoElement | undefined>();

  // Region selector state (video pixel coordinates)
  let region = $state<{ x: number; y: number; w: number; h: number } | null>(null);
  let isDrawing = $state(false);
  let startX = 0;
  let startY = 0;

  let selectionCanvas = $state<HTMLCanvasElement | undefined>();

  function resizeSelectionCanvas() {
    if (!videoElement || !selectionCanvas) return;
    const rect = videoElement.getBoundingClientRect();
    // Note: full rotation/SAR support would require reading video metadata (ffprobe or video attributes)
    selectionCanvas.width = rect.width;
    selectionCanvas.height = rect.height;
    redrawSelection();
  }

  function redrawSelection() {
    if (!selectionCanvas || !videoElement) return;
    const ctx = selectionCanvas.getContext('2d', { alpha: true })!;
    ctx.clearRect(0, 0, selectionCanvas.width, selectionCanvas.height);

    if (!region) return;

    // Convert intrinsic video pixels → displayed canvas pixels
    const scaleX = selectionCanvas.width / videoElement.videoWidth;
    const scaleY = selectionCanvas.height / videoElement.videoHeight;

    const x = region.x * scaleX;
    const y = region.y * scaleY;
    const w = region.w * scaleX;
    const h = region.h * scaleY;

    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2;
    ctx.fillStyle = 'rgba(239, 68, 68, 0.2)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
  }

  // Keep canvas perfectly sized to the actual displayed video area
  $effect(() => {
    if (videoElement && selectionCanvas) {
      const ro = new ResizeObserver(() => resizeSelectionCanvas());
      ro.observe(videoElement);

      // also react to region changes for redraw
      if (region) redrawSelection();

      return () => ro.disconnect();
    }
  });

  function getVideoContentRect() {
    if (!videoElement) return null;
    const videoRect = videoElement.getBoundingClientRect();
    const videoRatio = videoElement.videoWidth / videoElement.videoHeight;
    const containerRatio = videoRect.width / videoRect.height;

    let displayedWidth: number, displayedHeight: number, offsetX: number, offsetY: number;

    if (videoRatio > containerRatio) {
      displayedWidth = videoRect.width;
      displayedHeight = videoRect.width / videoRatio;
      offsetX = 0;
      offsetY = (videoRect.height - displayedHeight) / 2;
    } else {
      displayedHeight = videoRect.height;
      displayedWidth = videoRect.height * videoRatio;
      offsetX = (videoRect.width - displayedWidth) / 2;
      offsetY = 0;
    }
    return { displayedWidth, displayedHeight, offsetX, offsetY, videoRect };
  }

  function canvasToVideoCoords(clientX: number, clientY: number) {
    if (!videoElement || !selectionCanvas) return null;
    const content = getVideoContentRect();
    if (!content) return null;

    const scaleX = videoElement.videoWidth / content.displayedWidth;
    const scaleY = videoElement.videoHeight / content.displayedHeight;

    const x = (clientX - content.videoRect.left - content.offsetX) * scaleX;
    const y = (clientY - content.videoRect.top - content.offsetY) * scaleY;

    return { x: Math.max(0, Math.min(x, videoElement.videoWidth)), 
             y: Math.max(0, Math.min(y, videoElement.videoHeight)) };
  }

  let operations = $state<any[]>([]);
  let progress = $state(0);
  let isProcessing = $state(false);
  let videoDuration = $state(0);

  async function selectVideo() {
    const selected = await open({
      multiple: false,
      filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm'] }]
    });
    if (!selected) return;

    const path = Array.isArray(selected) ? selected[0] : selected;
    videoPath = path;
    videoSrc = convertFileSrc(path);   // correct Tauri way for local files
    region = null;
    operations = [];
    progress = 0;
    videoDuration = 0;
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer?.files[0];
    if (file && file.type.startsWith('video/')) {
      videoSrc = URL.createObjectURL(file);
      videoPath = null; // drop doesn't give real path easily - recommend using Open button
      region = null;
      operations = [];
      videoDuration = 0;
    }
  }

  function startDraw(e: MouseEvent) {
    if (!videoElement) return;
    if (!videoElement.paused) videoElement.pause(); // good UX - matches the online tool

    const coords = canvasToVideoCoords(e.clientX, e.clientY);
    if (!coords) return;

    startX = coords.x;
    startY = coords.y;
    isDrawing = true;
    region = { x: startX, y: startY, w: 0, h: 0 };
    redrawSelection();
  }

  function draw(e: MouseEvent) {
    if (!isDrawing || !videoElement) return;

    const coords = canvasToVideoCoords(e.clientX, e.clientY);
    if (!coords) return;

    const currentX = coords.x;
    const currentY = coords.y;

    region = {
      x: Math.min(startX, currentX),
      y: Math.min(startY, currentY),
      w: Math.abs(currentX - startX),
      h: Math.abs(currentY - startY)
    };
    redrawSelection();
  }

  function endDraw() {
    isDrawing = false;
    redrawSelection();
  }

  let tempStart = $state<number | null>(null);
  let tempEnd = $state<number | null>(null);

  function applyOperation(mode: 'blur' | 'crop' | 'text') {
    if (!region) return;
    operations = [...operations, {
      id: Date.now(),
      mode,
      region: { ...region },
      blurStrength: mode === 'blur' ? 20 : undefined,
      startTime: tempStart,
      endTime: tempEnd,
      text: mode === 'text' ? 'Sample Text' : undefined,
      fontSize: mode === 'text' ? 32 : undefined
    }];
    region = null;
    tempStart = null;
    tempEnd = null;
    redrawSelection();
  }

  function removeOperation(id: number) {
    operations = operations.filter(op => op.id !== id);
  }

  async function exportVideo() {
    if (!videoPath || operations.length === 0) {
      alert('Please open a video using the "Open video" button (drag&drop has no real path yet)');
      return;
    }

    isProcessing = true;
    progress = 0;

    const unlisten = await listen<any>('ffmpeg-progress', (event) => {
      const data = event.payload;
      const current = data.current ?? data;
      if (videoDuration > 0) {
        progress = Math.min((current / videoDuration) * 100, 100);
      } else {
        progress = current;
      }

      // Store ETA if available (for future UI)
      if (data.eta) {
        console.log('ETA:', Math.round(data.eta), 'seconds');
      }
    });

    try {
      const outputPath = videoPath.replace(/(\.[^.]+)$/, '_no_logo$1');

      // Send the full list of operations — Rust now chains them all
      const finalPath = await invoke<string>('remove_logo', {
        req: {
          input_path: videoPath,
          output_path: outputPath,
          video_duration: videoDuration,
          operations: operations.map(op => ({
            mode: op.mode,
            region: op.region ? {
              x: Math.floor(op.region.x),
              y: Math.floor(op.region.y),
              w: Math.floor(op.region.w),
              h: Math.floor(op.region.h),
            } : null,
            blur_strength: op.blurStrength ?? 20,
            start_time: op.startTime,
            end_time: op.endTime,
            text: op.text,
            font_size: op.fontSize,
            font_color: "white"
          }))
        }
      });

      alert(`Done! Saved to:\n${finalPath}\n\nApplied ${operations.length} operation(s)`);
    } catch (e) {
      alert('Error: ' + e);
    } finally {
      unlisten();
      isProcessing = false;
    }
  }
</script>

<main class="h-screen flex flex-col bg-zinc-950 text-zinc-200">
  <header class="flex items-center justify-between p-4 border-b border-zinc-800">
    <div class="font-semibold text-xl">Beru</div>
    <button 
      onclick={selectVideo}
      class="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm flex items-center gap-2"
    >
      📁 Open video
    </button>
  </header>

  <div class="flex-1 flex overflow-hidden">
    <!-- Video preview area -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="flex-1 flex items-center justify-center bg-black relative"
         ondrop={onDrop}
         ondragover={(e) => e.preventDefault()}>
      
      {#if videoSrc}
        <div class="relative inline-block" style="max-width: 100%; max-height: 85vh;">
          <video 
            bind:this={videoElement}
            src={videoSrc}
            controls
            class="max-h-[85vh] max-w-full rounded shadow-2xl"
            style="object-fit: contain; display: block;"
            onloadedmetadata={(e) => {
              region = null;
              videoDuration = (e.currentTarget as HTMLVideoElement).duration;
              setTimeout(resizeSelectionCanvas, 50);
            }}
            onplay={() => region = null}
          ></video>

          <!-- Accurate canvas overlay for region selection -->
          <canvas
            bind:this={selectionCanvas}
            class="absolute top-0 left-0 pointer-events-auto cursor-crosshair"
            style="max-width: 100%; max-height: 85vh; border-radius: 0.5rem;"
            onmousedown={startDraw}
            onmousemove={draw}
            onmouseup={endDraw}
            onmouseleave={endDraw}
          ></canvas>
        </div>
      {:else}
        <div class="text-center text-zinc-500">
          <div class="text-6xl mb-4">📹</div>
          <p class="text-lg">Drop video here or click Open</p>
          <p class="text-xs mt-2">MP4, MOV, AVI, MKV • 100% local</p>
        </div>
      {/if}
    </div>

    <!-- Sidebar: operations -->
    <div class="w-72 border-l border-zinc-800 p-4 flex flex-col">
      <div class="text-sm font-medium mb-3 text-zinc-400">REGION / TEXT</div>
      
      {#if region}
        <div class="mb-3 p-3 bg-zinc-900 rounded text-xs font-mono">
          x: {Math.round(region.x)} y: {Math.round(region.y)}<br>
          w: {Math.round(region.w)} h: {Math.round(region.h)}
        </div>

        <!-- Time range (optional) -->
        <div class="grid grid-cols-2 gap-2 mb-3 text-xs">
          <label class="flex flex-col">
            Start (s)
            <input type="number" bind:value={tempStart} placeholder="0" class="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-sm" />
          </label>
          <label class="flex flex-col">
            End (s)
            <input type="number" bind:value={tempEnd} placeholder="end" class="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-sm" />
          </label>
        </div>

        <div class="flex gap-2 mb-3">
          <button onclick={() => applyOperation('blur')} class="flex-1 bg-blue-600 hover:bg-blue-500 py-2 rounded text-sm font-medium">Blur</button>
          <button onclick={() => applyOperation('crop')} class="flex-1 bg-amber-600 hover:bg-amber-500 py-2 rounded text-sm font-medium">Crop</button>
          <button onclick={() => applyOperation('text')} class="flex-1 bg-violet-600 hover:bg-violet-500 py-2 rounded text-sm font-medium">Text</button>
          <button onclick={() => alert('Image overlay coming next - will allow picking PNG to cover the region')} 
                  class="flex-1 bg-teal-700 hover:bg-teal-600 py-2 rounded text-sm font-medium opacity-70">Image</button>
        </div>

        <button 
          onclick={() => { region = null; redrawSelection(); tempStart = null; tempEnd = null; }}
          class="text-xs text-zinc-400 hover:text-zinc-200 mb-4">
          Cancel selection
        </button>
      {:else if videoSrc}
        <div class="text-xs text-zinc-500 mb-6">Draw rectangles on the video. You can queue multiple blur/crop operations — they will be applied in order.</div>
      {/if}

      <div class="text-sm font-medium mb-2 text-zinc-400 mt-auto">APPLIED OPERATIONS</div>
      {#if operations.length === 0}
        <div class="text-xs text-zinc-600">None yet</div>
      {:else}
        <div class="space-y-1 text-sm">
          {#each operations as op}
            <div class="flex items-center justify-between bg-zinc-900 px-3 py-1.5 rounded text-xs">
              <span>
                {op.mode.toUpperCase()} 
                {#if op.mode === 'text' && op.text}
                  “{op.text}”
                {:else if op.region}
                  {op.region.w}×{op.region.h}
                {/if}
                {#if op.startTime || op.endTime}
                  <span class="text-amber-400">[{op.startTime ?? 0}s - {op.endTime ?? 'end'}]</span>
                {/if}
              </span>
              <button onclick={() => removeOperation(op.id)} class="text-red-400 hover:text-red-300">×</button>
            </div>
          {/each}
          <button 
            onclick={() => operations = []}
            class="mt-1 text-[10px] text-red-400 hover:text-red-300">
            Clear all
          </button>
        </div>
      {/if}

      {#if isProcessing}
        <div class="mt-3 h-2 bg-zinc-800 rounded overflow-hidden">
          <div class="h-2 bg-emerald-500 transition-all" style="width: {progress}%"></div>
        </div>
        <button 
          onclick={async () => { await invoke('cancel_processing'); isProcessing = false; }}
          class="mt-2 w-full py-1.5 text-sm bg-red-600 hover:bg-red-500 rounded">
          Cancel processing
        </button>
      {/if}

      <button 
        onclick={exportVideo}
        disabled={operations.length === 0 || isProcessing}
        class="mt-6 w-full py-3 bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-500 rounded-lg font-medium">
        {isProcessing 
          ? (videoDuration > 0 
              ? `Processing... ${Math.floor(progress)}%` 
              : `Processing... ${Math.floor(progress)}s`)
          : 'Export video'}
      </button>
    </div>
  </div>
</main>

<style>
  :global(body) { margin: 0; }
</style>
