<!-- LayerList.svelte — List of operations (layers) with reorder/delete/duplicate/edit -->
<script lang="ts">
  import { MODE_META } from '$lib/types';
  import type { Operation } from '$lib/video-utils';

  let {
    operations = $bindable([]),
    onRemove,
    onMove,
    onDuplicate,
    onEditRegion,
    onApplyStyle,
    onClearOps,
    onStyleTextOp,
  }: {
    operations?: Operation[];
    onRemove: (idx: number) => void;
    onMove: (idx: number, dir: -1 | 1) => void;
    onDuplicate: (idx: number) => void;
    onEditRegion: (idx: number) => void;
    onApplyStyle: (idx: number) => void;
    onClearOps: () => void;
    onStyleTextOp: (idx: number) => void;
  } = $props();
</script>

<div class="cap-section">
  <div class="cap-section-title">
    Capas ({operations.length})
  </div>
  {#if operations.length === 0}
    <div class="text-[11px]" style="color:var(--text-dim)">Sin capas a&uacute;n</div>
  {:else}
    <div class="space-y-1.5 pb-4">
      {#each operations as op, oi}
        <div class="cap-op-item group">
          <span class="uppercase font-bold w-10 shrink-0 text-[10px]" style="color:{op.mode === 'blur' ? 'var(--accent)' : op.mode === 'crop' ? 'var(--amber)' : 'var(--purple)'}">
            {MODE_META[op.mode]?.label ?? op.mode}
          </span>
          {#if op.mode === 'text' && op.text}
            <span class="text-[10px] flex-1 truncate" style="color:var(--text-secondary)">"{op.text}"</span>
          {:else if op.mode === 'blur'}
            <span class="text-[10px] flex-1" style="color:var(--text-dim)">blur={op.blurStrength ?? 20}</span>
          {:else}
            <span class="text-[10px] flex-1" style="color:var(--text-dim)">{op.region ? `${Math.round(op.region.w)}x${Math.round(op.region.h)}` : ''}</span>
          {/if}
          <div class="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            {#if op.mode === 'text'}
              <button onclick={() => onStyleTextOp(oi)} class="cap-btn-icon !w-5 !h-5" title="Aplicar estilo actual" style="color:var(--accent)">
                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7V4h16v3M9 20h6M12 4v16"/></svg>
              </button>
            {/if}
            <button onclick={() => onEditRegion(oi)} class="cap-btn-icon !w-5 !h-5" title="Editar regi&oacute;n" style="color:var(--text-muted)">
              <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg>
            </button>
            <button onclick={() => onMove(oi, -1)} class="cap-btn-icon !w-5 !h-5" title="Subir" style="color:var(--text-muted)">
              <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"/></svg>
            </button>
            <button onclick={() => onMove(oi, 1)} class="cap-btn-icon !w-5 !h-5" title="Bajar" style="color:var(--text-muted)">
              <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>
            </button>
            <button onclick={() => onDuplicate(oi)} class="cap-btn-icon !w-5 !h-5" title="Duplicar" style="color:var(--text-muted)">
              <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
            </button>
            <button onclick={() => onRemove(oi)} class="cap-btn-icon !w-5 !h-5" title="Eliminar" style="color:var(--rose)">
              <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
            </button>
          </div>
        </div>
      {/each}
      <button onclick={onClearOps} class="text-[10px] hover:underline mt-1" style="color:var(--text-dim)">Limpiar todo</button>
    </div>
  {/if}
</div>
