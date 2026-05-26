<!-- Header.svelte — Top bar: logo, badges, undo/redo, format/speed, import/export -->
<script lang="ts">
  import type { QueueItem } from '$lib/types';

  let {
    queue,
    isProcessingAll = $bindable(false),
    batchSummary,
    exportFormat = $bindable('mp4'),
    speedPreset = $bindable('ultrafast'),
    canUndo = false,
    canRedo = false,
    hasSelected = false,
    onUndo,
    onRedo,
    onAddVideo,
    onProcessAll,
    onCancelAll,
    onShowShortcuts,
  }: {
    queue: QueueItem[];
    isProcessingAll?: boolean;
    batchSummary: { total: number; succeeded: number; failed: number } | null;
    exportFormat?: string;
    speedPreset?: string;
    canUndo: boolean;
    canRedo: boolean;
    hasSelected: boolean;
    onUndo: () => void;
    onRedo: () => void;
    onAddVideo: () => void;
    onProcessAll: () => void;
    onCancelAll: () => void;
    onShowShortcuts: () => void;
  } = $props();

  const readyCount = $derived(queue.filter(q => q.operations.length > 0).length);
</script>

<header class="cap-header">
  <div class="cap-logo">
    <div class="cap-logo-icon">
      <svg class="w-4 h-4 text-[#0a0a0a]" fill="currentColor" viewBox="0 0 24 24">
        <path d="M8 5v14l11-7z"/>
      </svg>
    </div>
    <span class="cap-logo-text">Beru</span>
  </div>
  <span class="cap-badge cap-badge-local">Offline</span>
  {#if batchSummary && !isProcessingAll}
    <span class="cap-badge" style="background:{batchSummary.failed > 0 ? 'var(--amber-soft)' : 'rgba(52,211,153,0.1)'};border:1px solid {batchSummary.failed > 0 ? 'rgba(251,191,36,0.25)' : 'rgba(52,211,153,0.25)'};color:{batchSummary.failed > 0 ? 'var(--amber)' : 'var(--emerald)'}">
      {batchSummary.succeeded}/{batchSummary.total} exportados{batchSummary.failed > 0 ? ` · ${batchSummary.failed} error` : ''}
    </span>
  {/if}
  <div class="flex-1"></div>
  {#if hasSelected}
    <button onclick={onUndo} disabled={!canUndo} class="cap-btn-icon" title="Deshacer (Ctrl+Z)">
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"/></svg>
    </button>
    <button onclick={onRedo} disabled={!canRedo} class="cap-btn-icon" title="Rehacer (Ctrl+Y)">
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 10H11a8 8 0 00-8 8v2m18-10l-6 6m6-6l-6-6"/></svg>
    </button>
    <div class="w-px h-6 mx-1" style="background:var(--border)"></div>
  {/if}
  <button onclick={onShowShortcuts} class="cap-btn-icon" title="Atajos (?)">
    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
  </button>
  <label class="cap-select-label">
    Formato
    <select bind:value={exportFormat} class="cap-select">
      <option value="mp4">MP4</option>
      <option value="mkv">MKV</option>
      <option value="avi">AVI</option>
      <option value="mov">MOV</option>
      <option value="webm">WebM</option>
    </select>
  </label>
  <label class="cap-select-label">
    Velocidad
    <select bind:value={speedPreset} class="cap-select">
      <option value="ultrafast">ultrafast</option>
      <option value="superfast">superfast</option>
      <option value="veryfast">veryfast</option>
      <option value="fast">fast</option>
      <option value="medium">medium</option>
    </select>
  </label>
  <button onclick={onAddVideo} class="cap-btn-secondary">
    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
    Importar
  </button>
  {#if isProcessingAll}
    <button onclick={onCancelAll} class="cap-btn-danger">Cancelar</button>
  {:else}
    <button onclick={onProcessAll} disabled={readyCount === 0} class="cap-btn-export">
      <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
      Exportar {readyCount || ''}
    </button>
  {/if}
</header>
