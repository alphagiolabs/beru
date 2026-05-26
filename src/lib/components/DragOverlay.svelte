<!-- DragOverlay.svelte — Full-screen drag-and-drop indicator -->
<script lang="ts">
  let { isDragging }: { isDragging: boolean } = $props();
</script>

{#if isDragging}
  <div class="cap-drag-overlay">
    <div class="cap-drag-content">
      <svg class="w-12 h-12 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/>
      </svg>
      <p class="text-lg font-bold" style="color:var(--accent)">Suelta los videos aqu&iacute;</p>
      <p class="text-xs mt-1" style="color:var(--text-muted)">MP4, MOV, AVI, MKV, WebM</p>
    </div>
  </div>
{/if}
