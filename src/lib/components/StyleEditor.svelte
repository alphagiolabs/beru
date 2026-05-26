<!-- StyleEditor.svelte — Text style controls (font, bold, italic, bg, border) -->
<script lang="ts">
  import { FONT_FAMILIES } from '$lib/types';

  let {
    fontFamily = $bindable('Arial'),
    bold = $bindable(false),
    italic = $bindable(false),
    fontSize = $bindable(32),
    fontColor = $bindable('white'),
    bgEnabled = $bindable(true),
    bgColor = $bindable('black'),
    bgOpacity = $bindable(0.65),
    borderWidth = $bindable(0),
    borderColor = $bindable('black'),
  }: {
    fontFamily?: string;
    bold?: boolean;
    italic?: boolean;
    fontSize?: number;
    fontColor?: string;
    bgEnabled?: boolean;
    bgColor?: string;
    bgOpacity?: number;
    borderWidth?: number;
    borderColor?: string;
  } = $props();
</script>

<div class="grid grid-cols-2 gap-2">
  <label>
    <span class="cap-input-label">Tama&ntilde;o</span>
    <input type="number" bind:value={fontSize} min="8" max="200" class="cap-input font-mono text-[11px]" />
  </label>
  <label>
    <span class="cap-input-label">Color</span>
    <input type="text" bind:value={fontColor} placeholder="white" class="cap-input text-[11px]" />
  </label>
</div>
<label>
  <span class="cap-input-label">Fuente</span>
  <select bind:value={fontFamily} class="cap-input text-[11px]">
    {#each FONT_FAMILIES as family}
      <option value={family}>{family}</option>
    {/each}
  </select>
</label>
<div class="flex items-center gap-1.5">
  <button onclick={() => bold = !bold}
    class="px-3 py-1.5 rounded-md text-xs font-bold border transition-colors {bold ? 'border-[var(--accent-border)] text-[var(--accent)]' : ''}"
    style="background:var(--bg-input);border-color:var(--border);color:{bold ? 'var(--accent)' : 'var(--text-muted)'}">B</button>
  <button onclick={() => italic = !italic}
    class="px-3 py-1.5 rounded-md text-xs italic border transition-colors"
    style="background:var(--bg-input);border-color:{italic ? 'var(--accent-border)' : 'var(--border)'};color:{italic ? 'var(--accent)' : 'var(--text-muted)'}">I</button>
</div>
<div class="cap-card">
  <label class="flex items-center justify-between text-[10px] mb-2 cursor-pointer" style="color:var(--text-secondary)">
    <span>Fondo</span>
    <input type="checkbox" bind:checked={bgEnabled} style="accent-color:var(--accent)" />
  </label>
  {#if bgEnabled}
    <div class="grid grid-cols-2 gap-2">
      <label>
        <span class="cap-input-label">Color fondo</span>
        <input type="text" bind:value={bgColor} class="cap-input text-[11px]" />
      </label>
      <label>
        <span class="cap-input-label">Opacidad</span>
        <input type="number" bind:value={bgOpacity} min="0" max="1" step="0.05" class="cap-input font-mono text-[11px]" />
      </label>
    </div>
  {/if}
</div>
<div class="cap-card">
  <div class="cap-input-label mb-2">Contorno</div>
  <div class="grid grid-cols-2 gap-2">
    <label>
      <span class="cap-input-label">Ancho (px)</span>
      <input type="number" bind:value={borderWidth} min="0" max="20" class="cap-input font-mono text-[11px]" />
    </label>
    <label>
      <span class="cap-input-label">Color</span>
      <input type="text" bind:value={borderColor} class="cap-input text-[11px]" />
    </label>
  </div>
</div>
