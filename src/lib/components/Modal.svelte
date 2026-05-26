<!-- Modal.svelte — Reusable modal backdrop + container -->
<script lang="ts">
  import type { Snippet } from 'svelte';

  let { open = $bindable(false), maxWidth = 'max-w-md', width = 'w-full', height = '', children }: {
    open?: boolean;
    maxWidth?: string;
    width?: string;
    height?: string;
    children: Snippet;
  } = $props();

  function onBackdropClick() { open = false; }
  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') { open = false; e.stopPropagation(); }
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="cap-modal-backdrop" onclick={onBackdropClick} onkeydown={onKeydown}>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="cap-modal {maxWidth} {width} {height}" onclick={(e) => e.stopPropagation()} onkeydown={onKeydown}>
      {@render children()}
    </div>
  </div>
{/if}
