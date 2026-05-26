<!-- ToolBar.svelte — Blur / Delogo / Crop / Text tool selector -->
<script lang="ts">
  let {
    activeTool = $bindable('blur'),
    visible = true,
  }: {
    activeTool?: 'blur' | 'crop' | 'text' | 'delogo';
    visible?: boolean;
  } = $props();
</script>

{#if visible}
  <div class="cap-toolbar shrink-0">
    <button onclick={() => activeTool = 'blur'} class="cap-tool-btn {activeTool === 'blur' ? 'active-blur' : ''}">
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9-4.03-9-9-9zm0 0v18M3 12h18"/></svg>
      Desenfoque
    </button>
    <button onclick={() => activeTool = 'delogo'} class="cap-tool-btn {activeTool === 'delogo' ? 'active-delogo' : ''}">
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 3l18 18"/></svg>
      Remover Logo
    </button>
    <button onclick={() => activeTool = 'crop'} class="cap-tool-btn {activeTool === 'crop' ? 'active-crop' : ''}">
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M7 3h10a2 2 0 012 2v10a2 2 0 01-2 2H7a2 2 0 01-2-2V5a2 2 0 012-2z"/></svg>
      Recorte
    </button>
    <button onclick={() => activeTool = 'text'} class="cap-tool-btn {activeTool === 'text' ? 'active-text' : ''}">
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 7V4h16v3M9 20h6M12 4v16"/></svg>
      Texto
    </button>
  </div>
{/if}
