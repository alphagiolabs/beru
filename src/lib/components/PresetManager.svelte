<!-- PresetManager.svelte — Save/load/delete text style presets -->
<script lang="ts">
  export type TextPreset = {
    name: string;
    fontFamily: string;
    bold: boolean;
    italic: boolean;
    fontSize: number;
    fontColor: string;
    bgEnabled: boolean;
    bgColor: string;
    bgOpacity: number;
    borderWidth: number;
    borderColor: string;
  };

  let {
    presets = $bindable([]),
    currentStyle,
    onApply,
  }: {
    presets?: TextPreset[];
    currentStyle: () => TextPreset;
    onApply: (preset: TextPreset) => void;
  } = $props();

  let presetName = $state('');

  function savePreset() {
    const name = presetName.trim() || `Preset ${presets.length + 1}`;
    const p: TextPreset = { ...currentStyle(), name };
    presets = [...presets, p];
    saveToStorage();
    presetName = '';
  }

  function deletePreset(idx: number) {
    presets = presets.filter((_, i) => i !== idx);
    saveToStorage();
  }

  function saveToStorage() {
    try { localStorage.setItem('beru-presets', JSON.stringify(presets)); } catch {}
  }

  export function loadFromStorage() {
    try {
      const raw = localStorage.getItem('beru-presets');
      if (raw) presets = JSON.parse(raw);
    } catch {}
  }
</script>

<div class="cap-card mb-3">
  <div class="cap-input-label font-semibold mb-2">Presets de estilo</div>
  <div class="flex gap-1.5 mb-2">
    <input type="text" bind:value={presetName} placeholder="Nombre..." class="cap-input flex-1 text-[11px]" />
    <button onclick={savePreset} class="cap-btn-secondary text-[10px] !py-1.5 shrink-0">Guardar</button>
  </div>
  {#if presets.length > 0}
    <div class="space-y-1 max-h-24 overflow-y-auto">
      {#each presets as p, pi}
        <div class="flex items-center gap-1 group">
          <button onclick={() => onApply(p)}
            class="flex-1 text-left px-2 py-1.5 rounded-md text-[10px] truncate transition-colors hover:bg-[var(--bg-hover)]"
            style="color:var(--text-secondary)">
            {p.name}
            <span style="color:var(--text-dim)" class="ml-1">{p.fontFamily} {p.fontSize}px</span>
          </button>
          <button onclick={() => deletePreset(pi)} class="cap-btn-icon !w-6 !h-6 opacity-0 group-hover:opacity-100" style="color:var(--rose)" title="Eliminar">
            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
      {/each}
    </div>
  {:else}
    <div class="text-[9px]" style="color:var(--text-dim)">Sin presets guardados.</div>
  {/if}
</div>
