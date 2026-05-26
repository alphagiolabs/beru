<!-- TableEditor.svelte — Full-screen table editor for batch text editing -->
<script lang="ts">
  import { findTextOpForRegion, regionsMatch } from '$lib/video-utils';
  import type { Operation, Region } from '$lib/video-utils';
  import type { QueueItem, TextRegion } from '$lib/types';
  import Modal from './Modal.svelte';

  let {
    open = $bindable(false),
    queue = $bindable([]),
    selectedIdx,
    templateRegions,
    region,
    textFontSize,
    textFontColor,
    textFontFamily,
    textBold,
    textItalic,
    textBgEnabled,
    textBgColor,
    textBgOpacity,
    textBorderWidth,
    textBorderColor,
    onSelectItem,
  }: {
    open?: boolean;
    queue?: QueueItem[];
    selectedIdx: number;
    templateRegions: TextRegion[];
    region: Region | null;
    textFontSize: number;
    textFontColor: string;
    textFontFamily: string;
    textBold: boolean;
    textItalic: boolean;
    textBgEnabled: boolean;
    textBgColor: string;
    textBgOpacity: number;
    textBorderWidth: number;
    textBorderColor: string;
    onSelectItem: (idx: number) => void;
  } = $props();

  type TableRow = { idx: number; name: string; texts: Record<string, string> };

  const labels = $derived(
    templateRegions.length > 0
      ? templateRegions.map(r => r.label)
      : ['text1']
  );

  const tableRows = $derived.by(() => {
    const rows: TableRow[] = [];
    for (let i = 0; i < queue.length; i++) {
      const item = queue[i]!;
      const texts: Record<string, string> = {};
      for (const label of labels) {
        const tr = templateRegions.find(r => r.label === label);
        let op: Operation | undefined;
        if (tr) {
          op = findTextOpForRegion(item.operations, tr.region);
        } else {
          op = item.operations.find(o => o.mode === 'text');
        }
        texts[label] = op?.text ?? '';
      }
      rows.push({ idx: i, name: item.customOutputName ?? `Video ${i + 1}`, texts });
    }
    return rows;
  });

  function updateTableText(itemIdx: number, label: string, value: string) {
    if (itemIdx < 0 || itemIdx >= queue.length) return;
    const item = queue[itemIdx]!;
    const regions = templateRegions.length > 0
      ? templateRegions
      : region
        ? [{ id: 0, region, label: 'text1' }]
        : [];
    const tr = regions.find(r => r.label === label);
    if (!tr) return;

    const existingIdx = item.operations.findIndex(
      (o) => o.mode === 'text' && o.region && regionsMatch(o.region, tr.region),
    );

    if (existingIdx >= 0) {
      item.operations = item.operations.map((o, i) =>
        i === existingIdx ? { ...o, text: value } : o,
      );
    } else if (value) {
      item.operations = [...item.operations, {
        id: Date.now() + Math.random(),
        mode: 'text',
        region: { ...tr.region },
        text: value,
        fontSize: textFontSize,
        fontColor: textFontColor,
        fontFamily: textFontFamily,
        bold: textBold,
        italic: textItalic,
        bgEnabled: textBgEnabled,
        bgColor: textBgColor,
        bgOpacity: textBgOpacity,
        borderWidth: textBorderWidth,
        borderColor: textBorderColor,
      }];
    } else {
      return;
    }
    queue = [...queue];
  }

  function addTableRow() {
    if (selectedIdx < 0 || selectedIdx >= queue.length) return;
    const templateItem = queue[selectedIdx]!;
    const regions = templateRegions.length > 0
      ? templateRegions
      : region
        ? [{ id: 0, region, label: 'text1' }]
        : [];
    if (regions.length === 0) return;

    const ops: Operation[] = regions.map(tr => ({
      id: Date.now() + Math.random(),
      mode: 'text' as const,
      region: { ...tr.region },
      text: '',
      fontSize: textFontSize,
      fontColor: textFontColor,
      fontFamily: textFontFamily,
      bold: textBold,
      italic: textItalic,
      bgEnabled: textBgEnabled,
      bgColor: textBgColor,
      bgOpacity: textBgOpacity,
      borderWidth: textBorderWidth,
      borderColor: textBorderColor,
    }));
    queue = [...queue, {
      ...templateItem,
      operations: ops,
      status: 'idle' as const,
      progress: 0,
      error: null,
      eta: null,
      speed: null,
      customOutputName: `Video ${queue.length + 1}`,
    }];
  }

  function deleteTableRow(itemIdx: number) {
    if (itemIdx < 0 || itemIdx >= queue.length) return;
    queue = queue.filter((_, i) => i !== itemIdx);
    if (selectedIdx >= queue.length) selectedIdx = Math.max(0, queue.length - 1);
  }
</script>

<Modal bind:open maxWidth="max-w-5xl" width="w-[90vw]" height="h-[80vh]">
  <div class="flex flex-col h-full">
    <div class="flex items-center justify-between px-5 py-3 border-b shrink-0" style="border-color:var(--border)">
      <div class="flex items-center gap-2">
        <svg class="w-4 h-4" style="color:var(--accent)" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
        <h2 class="text-sm font-bold">Editor de tabla</h2>
        <span class="text-[10px]" style="color:var(--text-muted)">{queue.length} videos &middot; {labels.length} columnas</span>
      </div>
      <div class="flex items-center gap-2">
        <button onclick={addTableRow} class="cap-btn-secondary text-[11px]">+ Fila</button>
        <button onclick={() => open = false} class="cap-btn-icon" aria-label="Cerrar">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>
    </div>

    <div class="flex-1 overflow-auto p-4">
      {#if tableRows.length === 0}
        <div class="text-center text-sm py-12" style="color:var(--text-muted)">
          Sin videos. Importa desde Excel o a&ntilde;ade videos primero.
        </div>
      {:else}
        <table class="w-full border-collapse text-xs">
          <thead>
            <tr class="sticky top-0" style="background:var(--bg-panel-elevated)">
              <th class="border px-2 py-2 text-left font-medium w-8" style="border-color:var(--border);color:var(--text-muted)">#</th>
              <th class="border px-2 py-2 text-left font-medium w-32" style="border-color:var(--border);color:var(--text-muted)">Nombre</th>
              {#each labels as label}
                <th class="border px-2 py-2 text-left font-medium" style="border-color:var(--border);color:var(--accent)">{label}</th>
              {/each}
              <th class="border px-2 py-2 text-center font-medium w-16" style="border-color:var(--border);color:var(--text-muted)"></th>
            </tr>
          </thead>
          <tbody>
            {#each tableRows as row, ri (row.idx)}
              <tr class="cursor-pointer transition-colors hover:bg-[var(--bg-hover)] {ri === selectedIdx ? 'bg-[var(--accent-soft)]' : ''}"
                onclick={() => { onSelectItem(row.idx); open = false; }}>
                <td class="border px-2 py-1.5 font-mono" style="border-color:var(--border);color:var(--text-dim)">{ri + 1}</td>
                <td class="border px-2 py-1.5" style="border-color:var(--border)">
                  <input type="text" value={row.name}
                    onclick={(e) => e.stopPropagation()}
                    onmousedown={(e) => e.stopPropagation()}
                    oninput={(e) => {
                      const v = (e.target as HTMLInputElement).value;
                      if (row.idx >= 0 && row.idx < queue.length) {
                        queue[row.idx]!.customOutputName = v;
                        queue = [...queue];
                      }
                    }}
                    class="bg-transparent border-none outline-none text-xs w-full" style="color:var(--text-primary)" />
                </td>
                {#each labels as label}
                  <td class="border px-2 py-1.5" style="border-color:var(--border)">
                    <input type="text" value={row.texts[label] ?? ''}
                      onclick={(e) => e.stopPropagation()}
                      onmousedown={(e) => e.stopPropagation()}
                      oninput={(e) => {
                        updateTableText(row.idx, label, (e.target as HTMLInputElement).value);
                      }}
                      class="bg-transparent border-none outline-none text-xs w-full"
                      style="color:var(--text-primary)"
                      placeholder="Texto..." />
                  </td>
                {/each}
                <td class="border px-2 py-1.5 text-center" style="border-color:var(--border)">
                  <button onclick={(e) => { e.stopPropagation(); deleteTableRow(row.idx); }}
                    class="cap-btn-icon !w-6 !h-6" style="color:var(--rose)" title="Eliminar fila">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                  </button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </div>

    <div class="px-5 py-3 border-t shrink-0 flex items-center justify-between" style="border-color:var(--border)">
      <span class="text-[10px]" style="color:var(--text-dim)">Clic en fila para seleccionar. Los cambios son en vivo.</span>
      <button onclick={() => open = false} class="cap-btn-export text-[12px] !py-1.5">Listo</button>
    </div>
  </div>
</Modal>
