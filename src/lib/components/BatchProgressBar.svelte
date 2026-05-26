<!-- BatchProgressBar.svelte — Shows batch processing progress -->
<script lang="ts">
  import type { QueueItem } from '$lib/types';

  let { queue, isProcessingAll }: {
    queue: QueueItem[];
    isProcessingAll: boolean;
  } = $props();

  const total = $derived(queue.filter(q => q.operations.length > 0).length);
  const done = $derived(queue.filter(q => q.status === 'done').length);
  const failed = $derived(queue.filter(q => q.status === 'error').length);
  const processing = $derived(queue.filter(q => q.status === 'processing').length);
  const pct = $derived(total > 0 ? Math.round((done / total) * 100) : 0);
</script>

{#if isProcessingAll}
  <div class="cap-batch-bar">
    <div class="flex items-center gap-3 mb-2">
      <span class="text-xs font-semibold" style="color:var(--text-primary)">Exportando lote</span>
      <span class="text-[10px]" style="color:var(--accent)">{done}/{total}</span>
      {#if failed > 0}<span class="text-[10px]" style="color:var(--rose)">{failed} error</span>{/if}
      {#if processing > 0}<span class="text-[10px]" style="color:var(--text-muted)">{processing} en proceso</span>{/if}
      <span class="text-[10px] ml-auto font-mono" style="color:var(--text-muted)">{pct}%</span>
    </div>
    <div class="cap-progress" style="height:4px">
      <div class="cap-progress-fill {pct >= 100 ? 'done' : ''}" style="width:{pct}%"></div>
    </div>
  </div>
{/if}
