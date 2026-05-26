<!-- BatchPanel.svelte — Template regions, Excel import, find & replace -->
<script lang="ts">
  import type { TextRegion } from '$lib/types';
  import type { Region } from '$lib/video-utils';

  let {
    selectedIdx,
    templateIdx = $bindable(-1),
    templateRegions = $bindable([]),
    nextRegionLabel = $bindable(1),
    region,
    batchFindText = $bindable(''),
    batchReplaceText = $bindable(''),
    batchFindScope = $bindable<'selected' | 'all'>('selected'),
    onAddTemplateRegion,
    onRemoveTemplateRegion,
    onSetTemplate,
    onImportExcel,
    onOpenTableEditor,
    onBatchFindReplace,
  }: {
    selectedIdx: number;
    templateIdx?: number;
    templateRegions?: TextRegion[];
    nextRegionLabel?: number;
    region: Region | null;
    batchFindText?: string;
    batchReplaceText?: string;
    batchFindScope?: 'selected' | 'all';
    onAddTemplateRegion: () => void;
    onRemoveTemplateRegion: (id: number) => void;
    onSetTemplate: (idx: number) => void;
    onImportExcel: () => void;
    onOpenTableEditor: () => void;
    onBatchFindReplace: () => void;
  } = $props();
</script>

<div class="space-y-2 mb-3">
  {#if templateIdx === selectedIdx}
    <div class="cap-card cap-card-info">
      <div class="text-[10px] font-semibold" style="color:var(--accent)">Video plantilla</div>
      <div class="text-[9px] mt-0.5" style="color:var(--text-muted)">Dibuja regiones y pulsa &ldquo;A&ntilde;adir regi&oacute;n&rdquo;.</div>
    </div>
  {:else}
    <button onclick={() => onSetTemplate(selectedIdx)} class="cap-btn-secondary w-full text-[11px]">
      Usar como plantilla
    </button>
  {/if}

  {#if templateRegions.length > 0}
    <div class="space-y-1">
      <div class="cap-input-label">Regiones ({templateRegions.length})</div>
      {#each templateRegions as tr}
        <div class="cap-op-item">
          <span class="font-semibold w-12" style="color:var(--purple)">{tr.label}</span>
          <span class="font-mono flex-1 text-[10px]" style="color:var(--text-dim)">{Math.round(tr.region.x)},{Math.round(tr.region.y)} {Math.round(tr.region.w)}x{Math.round(tr.region.h)}</span>
          <button onclick={() => onRemoveTemplateRegion(tr.id)} class="cap-btn-icon !w-5 !h-5" style="color:var(--rose)">&times;</button>
        </div>
      {/each}
    </div>
  {/if}

  {#if templateIdx === selectedIdx && region}
    <button onclick={onAddTemplateRegion} class="cap-btn-apply cap-btn-apply-text text-[11px]">
      A&ntilde;adir regi&oacute;n text{nextRegionLabel}
    </button>
  {/if}
</div>

<button onclick={onImportExcel} class="cap-btn-apply cap-btn-apply-text mb-2 flex items-center justify-center gap-2">
  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>
  Importar desde Excel
</button>

<button onclick={onOpenTableEditor} class="cap-btn-secondary w-full mb-3 flex items-center justify-center gap-2">
  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
  Editor de tabla
</button>

<div class="cap-card cap-card-warn mb-3">
  <div class="flex items-center gap-1.5 mb-2">
    <svg class="w-3.5 h-3.5" style="color:var(--amber)" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
    <span class="text-[11px] font-semibold" style="color:var(--amber)">Buscar y reemplazar</span>
  </div>
  <div class="space-y-1.5">
    <input bind:value={batchFindText} placeholder="Buscar..." class="cap-input text-[11px]" />
    <input bind:value={batchReplaceText} placeholder="Reemplazar con..." class="cap-input text-[11px]" />
    <div class="flex gap-1.5 items-center">
      <select bind:value={batchFindScope} class="cap-input flex-1 text-[11px]">
        <option value="selected">Video seleccionado</option>
        <option value="all">Todos los videos</option>
      </select>
      <button onclick={onBatchFindReplace} class="cap-btn-secondary text-[10px] !py-1.5 shrink-0">Reemplazar</button>
    </div>
  </div>
</div>
