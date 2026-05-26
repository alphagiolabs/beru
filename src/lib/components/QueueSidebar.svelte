<!-- QueueSidebar.svelte — Left panel: media queue with drag reordering -->
<script lang="ts">
  import { fmtTime } from '$lib/utils';
  import type { QueueItem } from '$lib/types';

  let {
    queue = $bindable([]),
    selectedIdx = $bindable(-1),
    templateIdx,
    onAddVideo,
    onSelectItem,
    onRemoveItem,
  }: {
    queue?: QueueItem[];
    selectedIdx?: number;
    templateIdx: number;
    onAddVideo: () => void;
    onSelectItem: (idx: number) => void;
    onRemoveItem: (idx: number) => void;
  } = $props();

  let queueDragIdx = $state<number | null>(null);
  let queueDropIdx = $state<number | null>(null);

  function formatEta(seconds: number): string {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return `${m}m${s}s`;
  }

  function reorderQueue(from: number, to: number) {
    if (from === to || from < 0 || to < 0) return;
    const item = queue[from]!;
    queue = queue.filter((_, i) => i !== from);
    queue = [...queue.slice(0, to), item, ...queue.slice(to)];
    if (selectedIdx === from) selectedIdx = to;
    else if (from < selectedIdx && to >= selectedIdx) selectedIdx--;
    else if (from > selectedIdx && to <= selectedIdx) selectedIdx++;
  }
</script>

<aside class="cap-sidebar cap-sidebar-left">
  <div class="cap-sidebar-header flex items-center justify-between">
    <span>Medios</span>
    <span class="font-mono text-[10px] normal-case tracking-normal" style="color:var(--accent)">{queue.length}</span>
  </div>
  <div class="flex-1 overflow-y-auto">
    {#if queue.length === 0}
      <div class="p-6 text-center cap-animate-in">
        <div class="cap-preview-empty-icon mx-auto mb-3" style="width:48px;height:48px">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 4v16m8-8H4"/></svg>
        </div>
        <p class="text-xs" style="color:var(--text-muted)">Importa videos</p>
        <button onclick={onAddVideo} class="cap-btn-secondary mt-3 mx-auto text-[11px]">Seleccionar archivos</button>
      </div>
    {:else}
      {#each queue as item, i}
        {@const isNear = Math.abs(i - selectedIdx) <= 2}
        {@const isSel = i === selectedIdx}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="cap-queue-item group {isSel ? 'selected' : ''} {queueDragIdx === i ? 'opacity-40' : ''}"
          onclick={() => onSelectItem(i)}
          onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelectItem(i); }}
          draggable="true"
          ondragstart={(e) => { queueDragIdx = i; e.dataTransfer!.effectAllowed = 'move'; }}
          ondragover={(e) => { e.preventDefault(); queueDropIdx = i; }}
          ondragleave={() => { if (queueDropIdx === i) queueDropIdx = null; }}
          ondrop={(e) => { e.preventDefault(); if (queueDragIdx !== null && queueDragIdx !== i) reorderQueue(queueDragIdx, i); queueDragIdx = null; queueDropIdx = null; }}
          ondragend={() => { queueDragIdx = null; queueDropIdx = null; }}>
          {#if queueDropIdx === i && queueDragIdx !== i}
            <div class="absolute left-0 right-0 -top-px h-0.5" style="background:var(--accent);box-shadow:0 0 8px var(--accent-glow)"></div>
          {/if}
          <div class="cap-queue-thumb">
            {#if isNear || isSel}
              <!-- svelte-ignore a11y_media_has_caption -->
              <video src={item.src} class="w-full h-full object-cover" muted
                preload={isSel ? 'metadata' : 'none'}></video>
            {:else}
              <div class="w-full h-full flex items-center justify-center">
                <svg class="w-4 h-4" style="color:var(--text-dim)" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/>
                </svg>
              </div>
            {/if}
            {#if item.status === 'done'}
              <div class="absolute inset-0 flex items-center justify-center text-[9px] font-bold" style="background:rgba(52,211,153,0.7);color:#fff">OK</div>
            {:else if item.status === 'processing'}
              <div class="absolute bottom-0 left-0 right-0 cap-progress"><div class="cap-progress-fill" style="width:{item.progress}%"></div></div>
            {:else if item.status === 'error'}
              <div class="absolute inset-0 flex items-center justify-center text-[9px]" style="background:rgba(251,113,133,0.7);color:#fff">ERR</div>
            {/if}
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-1 text-[11px] truncate font-medium" style="color:{isSel ? 'var(--text-primary)' : 'var(--text-secondary)'}">
              {#if i === templateIdx}
                <span class="px-1.5 py-0.5 rounded text-[8px] font-bold tracking-wide" style="background:var(--accent-soft);color:var(--accent);border:1px solid var(--accent-border)">TEMPLATE</span>
              {/if}
              {#if item.customOutputName}
                <span class="px-1.5 py-0.5 rounded text-[8px] font-bold" style="background:var(--purple-soft);color:var(--purple)">LOTE</span>
                <span class="truncate">{item.customOutputName}</span>
              {:else}
                <span class="truncate">{item.filename}</span>
              {/if}
            </div>
            <div class="text-[9px] font-mono mt-0.5" style="color:var(--text-dim)">{item.width}x{item.height} &middot; {fmtTime(item.duration)}</div>
            <div class="text-[9px] mt-0.5" style="color:var(--text-dim)">
              {item.operations.length} capa{item.operations.length !== 1 ? 's' : ''}
              {#if item.status === 'processing'}
                <span style="color:var(--accent)" class="ml-1">{item.progress ?? 0}%</span>
                {#if item.eta != null}<span style="color:var(--amber)" class="ml-0.5">{formatEta(item.eta)}</span>{/if}
              {/if}
              {#if item.status === 'done'}<span style="color:var(--emerald)" class="ml-1">Listo</span>{/if}
              {#if item.error}<span style="color:var(--rose)" class="ml-1 truncate block">{item.error}</span>{/if}
            </div>
          </div>
          <button onclick={(e) => { e.stopPropagation(); onRemoveItem(i); }}
            class="cap-btn-icon shrink-0 !w-6 !h-6 opacity-0 group-hover:opacity-100 hover:!text-[var(--rose)]"
            style="color:var(--text-dim)" disabled={item.status === 'processing'} title="Eliminar">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
      {/each}
    {/if}
  </div>
</aside>
