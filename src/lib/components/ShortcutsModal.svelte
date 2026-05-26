<!-- ShortcutsModal.svelte — Keyboard shortcuts display -->
<script lang="ts">
  import Modal from './Modal.svelte';

  let { open = $bindable(false) }: { open?: boolean } = $props();
</script>

<Modal bind:open>
  <div class="p-6 max-w-md w-full mx-4">
    <div class="flex items-center justify-between mb-5">
      <h2 class="text-base font-bold">Atajos de teclado</h2>
      <button onclick={() => open = false} class="cap-btn-icon" aria-label="Cerrar">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
      </button>
    </div>
    <div class="space-y-3">
      {#each [
        ['Ctrl+Z', 'Deshacer'],
        ['Ctrl+Y / Ctrl+Shift+Z', 'Rehacer'],
        ['Ctrl+O', 'Abrir videos'],
        ['?', 'Mostrar atajos'],
        ['Esc', 'Cerrar / Cancelar'],
      ] as [key, desc]}
        <div class="flex items-center justify-between">
          <span class="text-sm" style="color:var(--text-secondary)">{desc}</span>
          <kbd class="kbd">{key}</kbd>
        </div>
      {/each}
    </div>
  </div>
</Modal>
