# Descomponer +page.svelte en Componentes Reutilizables

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar el monolito de 1937 lineas (`src/routes/+page.svelte`) en ~12 componentes Svelte modulares, manteniendo la funcionalidad identica.

**Architecture:** Extraer dominios logicos claros en componentes con props/callbacks. Usar Svelte 5 runes (`$state`, `$props`, `$derived`) consistentemente. Cada componente recibe datos como props y emite cambios via callbacks. El componente padre (`+page.svelte`) orquesta la composicion.

**Tech Stack:** Svelte 5 (runes mode), TypeScript strict, Tailwind CSS v4, Tauri 2 API

---

## File Structure

```
src/lib/components/
  Header.svelte              — Top bar: logo, badges, undo/redo, format/speed selects, import/export buttons
  QueueSidebar.svelte        — Left panel: media queue list with drag reordering, thumbnails, status indicators
  VideoCanvas.svelte         — Center: video player + canvas overlay + live text/blur/crop previews
  ToolBar.svelte             — Bottom center: blur/crop/text tool selector buttons
  PropertyPanel.svelte       — Right panel: region coords, style controls, presets, layers list
  StyleEditor.svelte         — Text style controls: font, bold, italic, bg, border (reused in PropertyPanel)
  PresetManager.svelte       — Save/load/delete text presets
  BatchPanel.svelte          — Template regions, Excel import, table editor, find & replace
  LayerList.svelte           — List of operations (layers) with reorder/delete/duplicate/edit
  Modal.svelte               — Reusable modal backdrop + container
  ShortcutsModal.svelte      — Keyboard shortcuts modal content
  TableEditor.svelte         — Full-screen table editor for batch text editing
  BatchProgressBar.svelte    — Top bar showing batch processing progress
  DragOverlay.svelte         — Full-screen drag-and-drop overlay
```

src/lib/stores/
  editor.svelte.ts           — EXPANDED: central state store (queue, selectedIdx, operations, history, UI flags)

---

### Task 1: Extract Modal.svelte — Reusable modal shell

**Files:**
- Create: `src/lib/components/Modal.svelte`
- Modify: `src/routes/+page.svelte` (replace inline modals later)

The modal component wraps backdrop + content container. Currently hardcoded in two places (shortcuts modal ~L1801, table editor ~L1831).

- [ ] **Step 1: Create Modal.svelte**

```svelte
<!-- src/lib/components/Modal.svelte -->
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
    <div class="cap-modal {maxWidth} {width} {height}" onclick={(e) => e.stopPropagation()}>
      {@render children()}
    </div>
  </div>
{/if}
```

- [ ] **Step 2: Verify build still passes**

Run: `npm run check`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/Modal.svelte
git commit -m "refactor: extract Modal.svelte reusable shell component"
```

---

### Task 2: Extract ShortcutsModal.svelte

**Files:**
- Create: `src/lib/components/ShortcutsModal.svelte`
- Modify: `src/routes/+page.svelte` (~L1801-1830 replace with component)

- [ ] **Step 1: Create ShortcutsModal.svelte**

```svelte
<!-- src/lib/components/ShortcutsModal.svelte -->
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
```

- [ ] **Step 2: Replace inline shortcuts modal in +page.svelte**

Replace the `{#if showShortcuts}` block (~L1801-1830) with:
```svelte
<ShortcutsModal bind:open={showShortcuts} />
```
Add import at top: `import ShortcutsModal from '$lib/components/ShortcutsModal.svelte';`

- [ ] **Step 3: Verify build**

Run: `npm run check`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/ShortcutsModal.svelte src/routes/+page.svelte
git commit -m "refactor: extract ShortcutsModal.svelte from monolith"
```

---

### Task 3: Extract BatchProgressBar.svelte

**Files:**
- Create: `src/lib/components/BatchProgressBar.svelte`
- Modify: `src/routes/+page.svelte` (~L1308-1328)

- [ ] **Step 1: Create BatchProgressBar.svelte**

```svelte
<!-- src/lib/components/BatchProgressBar.svelte -->
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
```

- [ ] **Step 2: Replace inline batch bar in +page.svelte**

Replace the `{#if isProcessingAll}` block (~L1308-1328) with:
```svelte
<BatchProgressBar {queue} {isProcessingAll} />
```
Add import: `import BatchProgressBar from '$lib/components/BatchProgressBar.svelte';`

- [ ] **Step 3: Verify build**

Run: `npm run check`

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/BatchProgressBar.svelte src/routes/+page.svelte
git commit -m "refactor: extract BatchProgressBar.svelte from monolith"
```

---

### Task 4: Extract DragOverlay.svelte

**Files:**
- Create: `src/lib/components/DragOverlay.svelte`
- Modify: `src/routes/+page.svelte` (drag overlay markup)

- [ ] **Step 1: Create DragOverlay.svelte**

```svelte
<!-- src/lib/components/DragOverlay.svelte -->
<script lang="ts">
  let { isDragging }: { isDragging: boolean } = $props();
</script>

{#if isDragging}
  <div class="cap-drag-overlay">
    <div class="cap-drag-content">
      <svg class="w-12 h-12 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/>
      </svg>
      <p class="text-lg font-bold" style="color:var(--accent)">Suelta los videos aquí</p>
      <p class="text-xs mt-1" style="color:var(--text-muted)">MP4, MOV, AVI, MKV, WebM</p>
    </div>
  </div>
{/if}
```

- [ ] **Step 2: Replace inline drag overlay in +page.svelte**

Find and replace the drag overlay div with `<DragOverlay {isDragging} />`.
Add import: `import DragOverlay from '$lib/components/DragOverlay.svelte';`

- [ ] **Step 3: Verify build**

Run: `npm run check`

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/DragOverlay.svelte src/routes/+page.svelte
git commit -m "refactor: extract DragOverlay.svelte from monolith"
```

---

### Task 5: Extract Header.svelte

**Files:**
- Create: `src/lib/components/Header.svelte`
- Modify: `src/routes/+page.svelte` (~L1249-1305)

- [ ] **Step 1: Create Header.svelte**

```svelte
<!-- src/lib/components/Header.svelte -->
<script lang="ts">
  import type { QueueItem } from '$lib/types';

  let {
    queue,
    isProcessingAll = $bindable(false),
    batchSummary,
    exportFormat = $bindable('mp4'),
    speedPreset = $bindable('ultrafast'),
    canUndo = false,
    canRedo = false,
    hasSelected = false,
    onUndo,
    onRedo,
    onAddVideo,
    onProcessAll,
    onCancelAll,
    onShowShortcuts,
  }: {
    queue: QueueItem[];
    isProcessingAll?: boolean;
    batchSummary: { total: number; succeeded: number; failed: number } | null;
    exportFormat?: string;
    speedPreset?: string;
    canUndo: boolean;
    canRedo: boolean;
    hasSelected: boolean;
    onUndo: () => void;
    onRedo: () => void;
    onAddVideo: () => void;
    onProcessAll: () => void;
    onCancelAll: () => void;
    onShowShortcuts: () => void;
  } = $props();

  const readyCount = $derived(queue.filter(q => q.operations.length > 0).length);
</script>

<header class="cap-header">
  <div class="cap-logo">
    <div class="cap-logo-icon">
      <svg class="w-4 h-4 text-[#0a0a0a]" fill="currentColor" viewBox="0 0 24 24">
        <path d="M8 5v14l11-7z"/>
      </svg>
    </div>
    <span class="cap-logo-text">Beru</span>
  </div>
  <span class="cap-badge cap-badge-local">Offline</span>
  {#if batchSummary && !isProcessingAll}
    <span class="cap-badge" style="background:{batchSummary.failed > 0 ? 'var(--amber-soft)' : 'rgba(52,211,153,0.1)'};border:1px solid {batchSummary.failed > 0 ? 'rgba(251,191,36,0.25)' : 'rgba(52,211,153,0.25)'};color:{batchSummary.failed > 0 ? 'var(--amber)' : 'var(--emerald)'}">
      {batchSummary.succeeded}/{batchSummary.total} exportados{batchSummary.failed > 0 ? ` · ${batchSummary.failed} error` : ''}
    </span>
  {/if}
  <div class="flex-1"></div>
  {#if hasSelected}
    <button onclick={onUndo} disabled={!canUndo} class="cap-btn-icon" title="Deshacer (Ctrl+Z)">
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"/></svg>
    </button>
    <button onclick={onRedo} disabled={!canRedo} class="cap-btn-icon" title="Rehacer (Ctrl+Y)">
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 10H11a8 8 0 00-8 8v2m18-10l-6 6m6-6l-6-6"/></svg>
    </button>
    <div class="w-px h-6 mx-1" style="background:var(--border)"></div>
  {/if}
  <button onclick={onShowShortcuts} class="cap-btn-icon" title="Atajos (?)">
    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
  </button>
  <label class="cap-select-label">
    Formato
    <select bind:value={exportFormat} class="cap-select">
      <option value="mp4">MP4</option>
      <option value="mkv">MKV</option>
      <option value="avi">AVI</option>
      <option value="mov">MOV</option>
      <option value="webm">WebM</option>
    </select>
  </label>
  <label class="cap-select-label">
    Velocidad
    <select bind:value={speedPreset} class="cap-select">
      <option value="ultrafast">ultrafast</option>
      <option value="superfast">superfast</option>
      <option value="veryfast">veryfast</option>
      <option value="fast">fast</option>
      <option value="medium">medium</option>
    </select>
  </label>
  <button onclick={onAddVideo} class="cap-btn-secondary">
    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
    Importar
  </button>
  {#if isProcessingAll}
    <button onclick={onCancelAll} class="cap-btn-danger">Cancelar</button>
  {:else}
    <button onclick={onProcessAll} disabled={readyCount === 0} class="cap-btn-export">
      <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
      Exportar {readyCount || ''}
    </button>
  {/if}
</header>
```

- [ ] **Step 2: Replace inline header in +page.svelte**

Replace the `<header class="cap-header">...</header>` block with:
```svelte
<Header
  {queue}
  bind:isProcessingAll
  {batchSummary}
  bind:exportFormat
  bind:speedPreset
  canUndo={historyIndex > 0}
  canRedo={historyIndex < history.length - 1}
  hasSelected={!!selected}
  onUndo={undo}
  onRedo={redo}
  onAddVideo={addVideo}
  onProcessAll={processAll}
  onCancelAll={cancelAll}
  onShowShortcuts={() => showShortcuts = !showShortcuts}
/>
```
Add import: `import Header from '$lib/components/Header.svelte';`

- [ ] **Step 3: Verify build**

Run: `npm run check`

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/Header.svelte src/routes/+page.svelte
git commit -m "refactor: extract Header.svelte from monolith"
```

---

### Task 6: Extract QueueSidebar.svelte

**Files:**
- Create: `src/lib/components/QueueSidebar.svelte`
- Modify: `src/routes/+page.svelte` (~L1330-1460)

- [ ] **Step 1: Create QueueSidebar.svelte**

```svelte
<!-- src/lib/components/QueueSidebar.svelte -->
<script lang="ts">
  import { fmtTime } from '$lib/utils';
  import type { QueueItem } from '$lib/types';

  let {
    queue = $bindable([]),
    selectedIdx = $bindable(-1),
    templateIdx,
    onAddVideo,
    onSelectItem,
    onRemoveItem,
  }: {
    queue?: QueueItem[];
    selectedIdx?: number;
    templateIdx: number;
    onAddVideo: () => void;
    onSelectItem: (idx: number) => void;
    onRemoveItem: (idx: number) => void;
  } = $props();

  let queueDragIdx = $state<number | null>(null);
  let queueDropIdx = $state<number | null>(null);

  function formatEta(seconds: number): string {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return `${m}m${s}s`;
  }

  function reorderQueue(from: number, to: number) {
    if (from === to || from < 0 || to < 0) return;
    const item = queue[from]!;
    queue = queue.filter((_, i) => i !== from);
    queue = [...queue.slice(0, to), item, ...queue.slice(to)];
    if (selectedIdx === from) selectedIdx = to;
    else if (from < selectedIdx && to >= selectedIdx) selectedIdx--;
    else if (from > selectedIdx && to <= selectedIdx) selectedIdx++;
  }
</script>

<aside class="cap-sidebar cap-sidebar-left">
  <div class="cap-sidebar-header flex items-center justify-between">
    <span>Medios</span>
    <span class="font-mono text-[10px] normal-case tracking-normal" style="color:var(--accent)">{queue.length}</span>
  </div>
  <div class="flex-1 overflow-y-auto">
    {#if queue.length === 0}
      <div class="p-6 text-center cap-animate-in">
        <div class="cap-preview-empty-icon mx-auto mb-3" style="width:48px;height:48px">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 4v16m8-8H4"/></svg>
        </div>
        <p class="text-xs" style="color:var(--text-muted)">Importa videos</p>
        <button onclick={onAddVideo} class="cap-btn-secondary mt-3 mx-auto text-[11px]">Seleccionar archivos</button>
      </div>
    {:else}
      {#each queue as item, i}
        {@const isNear = Math.abs(i - selectedIdx) <= 2}
        {@const isSel = i === selectedIdx}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="cap-queue-item group {isSel ? 'selected' : ''} {queueDragIdx === i ? 'opacity-40' : ''}"
          onclick={() => onSelectItem(i)}
          onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelectItem(i); }}
          draggable="true"
          ondragstart={(e) => { queueDragIdx = i; e.dataTransfer!.effectAllowed = 'move'; }}
          ondragover={(e) => { e.preventDefault(); queueDropIdx = i; }}
          ondragleave={() => { if (queueDropIdx === i) queueDropIdx = null; }}
          ondrop={(e) => { e.preventDefault(); if (queueDragIdx !== null && queueDragIdx !== i) reorderQueue(queueDragIdx, i); queueDragIdx = null; queueDropIdx = null; }}
          ondragend={() => { queueDragIdx = null; queueDropIdx = null; }}>
          {#if queueDropIdx === i && queueDragIdx !== i}
            <div class="absolute left-0 right-0 -top-px h-0.5" style="background:var(--accent);box-shadow:0 0 8px var(--accent-glow)"></div>
          {/if}
          <div class="cap-queue-thumb">
            {#if isNear || isSel}
              <!-- svelte-ignore a11y_media_has_caption -->
              <video src={item.src} class="w-full h-full object-cover" muted
                preload={isSel ? 'metadata' : 'none'}></video>
            {:else}
              <div class="w-full h-full flex items-center justify-center">
                <svg class="w-4 h-4" style="color:var(--text-dim)" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/>
                </svg>
              </div>
            {/if}
            {#if item.status === 'done'}
              <div class="absolute inset-0 flex items-center justify-center text-[9px] font-bold" style="background:rgba(52,211,153,0.7);color:#fff">OK</div>
            {:else if item.status === 'processing'}
              <div class="absolute bottom-0 left-0 right-0 cap-progress"><div class="cap-progress-fill" style="width:{item.progress}%"></div></div>
            {:else if item.status === 'error'}
              <div class="absolute inset-0 flex items-center justify-center text-[9px]" style="background:rgba(251,113,133,0.7);color:#fff">ERR</div>
            {/if}
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-1 text-[11px] truncate font-medium" style="color:{isSel ? 'var(--text-primary)' : 'var(--text-secondary)'}">
              {#if i === templateIdx}
                <span class="px-1.5 py-0.5 rounded text-[8px] font-bold tracking-wide" style="background:var(--accent-soft);color:var(--accent);border:1px solid var(--accent-border)">TEMPLATE</span>
              {/if}
              {#if item.customOutputName}
                <span class="px-1.5 py-0.5 rounded text-[8px] font-bold" style="background:var(--purple-soft);color:var(--purple)">LOTE</span>
                <span class="truncate">{item.customOutputName}</span>
              {:else}
                <span class="truncate">{item.filename}</span>
              {/if}
            </div>
            <div class="text-[9px] font-mono mt-0.5" style="color:var(--text-dim)">{item.width}x{item.height} · {fmtTime(item.duration)}</div>
            <div class="text-[9px] mt-0.5" style="color:var(--text-dim)">
              {item.operations.length} capa{item.operations.length !== 1 ? 's' : ''}
              {#if item.status === 'processing'}
                <span style="color:var(--accent)" class="ml-1">{item.progress ?? 0}%</span>
                {#if item.eta != null}<span style="color:var(--amber)" class="ml-0.5">{formatEta(item.eta)}</span>{/if}
              {/if}
              {#if item.status === 'done'}<span style="color:var(--emerald)" class="ml-1">Listo</span>{/if}
              {#if item.error}<span style="color:var(--rose)" class="ml-1 truncate block">{item.error}</span>{/if}
            </div>
          </div>
          <button onclick={(e) => { e.stopPropagation(); onRemoveItem(i); }}
            class="cap-btn-icon shrink-0 !w-6 !h-6 opacity-0 group-hover:opacity-100 hover:!text-[var(--rose)]"
            style="color:var(--text-dim)" disabled={item.status === 'processing'} title="Eliminar">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
      {/each}
    {/if}
  </div>
</aside>
```

- [ ] **Step 2: Replace inline queue sidebar in +page.svelte**

Replace the `<aside class="cap-sidebar cap-sidebar-left">...</aside>` block with:
```svelte
<QueueSidebar
  bind:queue
  bind:selectedIdx
  {templateIdx}
  onAddVideo={addVideo}
  onSelectItem={selectQueueItem}
  onRemoveItem={removeQueueItem}
/>
```
Add import: `import QueueSidebar from '$lib/components/QueueSidebar.svelte';`

- [ ] **Step 3: Verify build**

Run: `npm run check`

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/QueueSidebar.svelte src/routes/+page.svelte
git commit -m "refactor: extract QueueSidebar.svelte from monolith"
```

---

### Task 7: Extract StyleEditor.svelte — Text style controls

**Files:**
- Create: `src/lib/components/StyleEditor.svelte`
- Modify: `src/routes/+page.svelte` (inline style controls in property panel)

- [ ] **Step 1: Create StyleEditor.svelte**

```svelte
<!-- src/lib/components/StyleEditor.svelte -->
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
    <span class="cap-input-label">Tamano</span>
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
```

- [ ] **Step 2: Replace inline style controls in +page.svelte property panel**

Replace the font family / bold / italic / bg / border inline controls with:
```svelte
<StyleEditor
  bind:fontFamily={textFontFamily}
  bind:bold={textBold}
  bind:italic={textItalic}
  bind:fontSize={textFontSize}
  bind:fontColor={textFontColor}
  bind:bgEnabled={textBgEnabled}
  bind:bgColor={textBgColor}
  bind:bgOpacity={textBgOpacity}
  bind:borderWidth={textBorderWidth}
  bind:borderColor={textBorderColor}
/>
```
Add import: `import StyleEditor from '$lib/components/StyleEditor.svelte';`

- [ ] **Step 3: Verify build**

Run: `npm run check`

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/StyleEditor.svelte src/routes/+page.svelte
git commit -m "refactor: extract StyleEditor.svelte text style controls"
```

---

### Task 8: Extract PresetManager.svelte

**Files:**
- Create: `src/lib/components/PresetManager.svelte`
- Modify: `src/routes/+page.svelte` (~L1570-1610)

- [ ] **Step 1: Create PresetManager.svelte**

```svelte
<!-- src/lib/components/PresetManager.svelte -->
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
```

- [ ] **Step 2: Replace inline presets in +page.svelte**

Replace the presets card (~L1570-1610) with:
```svelte
<PresetManager
  bind:presets
  currentStyle={() => ({
    name: '', fontFamily: textFontFamily, bold: textBold, italic: textItalic,
    fontSize: textFontSize, fontColor: textFontColor, bgEnabled: textBgEnabled,
    bgColor: textBgColor, bgOpacity: textBgOpacity, borderWidth: textBorderWidth,
    borderColor: textBorderColor,
  })}
  onApply={(p) => {
    textFontFamily = p.fontFamily; textBold = p.bold; textItalic = p.italic;
    textFontSize = p.fontSize; textFontColor = p.fontColor; textBgEnabled = p.bgEnabled;
    textBgColor = p.bgColor; textBgOpacity = p.bgOpacity; textBorderWidth = p.borderWidth;
    textBorderColor = p.borderColor;
  }}
/>
```
Add import: `import PresetManager from '$lib/components/PresetManager.svelte';`

Remove the inline `TextPreset` type, `presets`, `presetName`, `loadPresets`, `savePresets`, `savePreset`, `applyPreset`, `deletePreset` from the script block. Call `presetManagerRef.loadFromStorage()` in `onMount` instead of `loadPresets()`.

- [ ] **Step 3: Verify build**

Run: `npm run check`

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/PresetManager.svelte src/routes/+page.svelte
git commit -m "refactor: extract PresetManager.svelte from monolith"
```

---

### Task 9: Extract LayerList.svelte

**Files:**
- Create: `src/lib/components/LayerList.svelte`
- Modify: `src/routes/+page.svelte` (~L1690-1790)

- [ ] **Step 1: Create LayerList.svelte**

```svelte
<!-- src/lib/components/LayerList.svelte -->
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
    <div class="text-[11px]" style="color:var(--text-dim)">Sin capas aun</div>
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
              <button onclick={() => onStyleTextOp(oi)} class="cap-btn-icon !w-5 !h-5" title="Estilo" style="color:var(--accent)">
                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7V4h16v3M9 20h6M12 4v16"/></svg>
              </button>
            {/if}
            <button onclick={() => onEditRegion(oi)} class="cap-btn-icon !w-5 !h-5" title="Editar region" style="color:var(--text-muted)">
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
```

- [ ] **Step 2: Replace inline layers section in +page.svelte**

Replace the layers `<div class="cap-section">` block (~L1690-1790) with:
```svelte
<LayerList
  bind:operations={selected.operations}
  onRemove={removeOp}
  onMove={moveOp}
  onDuplicate={duplicateOp}
  onEditRegion={editOpRegion}
  onApplyStyle={applyStyleToOp}
  onClearOps={clearOps}
  onStyleTextOp={applyStyleToOp}
/>
```
Add import: `import LayerList from '$lib/components/LayerList.svelte';`

- [ ] **Step 3: Verify build**

Run: `npm run check`

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/LayerList.svelte src/routes/+page.svelte
git commit -m "refactor: extract LayerList.svelte operation list"
```

---

### Task 10: Extract TableEditor.svelte

**Files:**
- Create: `src/lib/components/TableEditor.svelte`
- Modify: `src/routes/+page.svelte` (~L1831-1920)

- [ ] **Step 1: Create TableEditor.svelte**

```svelte
<!-- src/lib/components/TableEditor.svelte -->
<script lang="ts">
  import { findTextOpForRegion, regionsMatch } from '$lib/video-utils';
  import type { Operation } from '$lib/video-utils';
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
    region: import('$lib/video-utils').Region | null;
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
        <span class="text-[10px]" style="color:var(--text-muted)">{queue.length} videos · {labels.length} columnas</span>
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
          Sin videos. Importa desde Excel o anade videos primero.
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
```

- [ ] **Step 2: Replace inline table editor in +page.svelte**

Replace the `{#if showTableEditor}` block (~L1831-1920) with:
```svelte
<TableEditor
  bind:open={showTableEditor}
  bind:queue
  {selectedIdx}
  {templateRegions}
  {region}
  {textFontSize}
  {textFontColor}
  {textFontFamily}
  {textBold}
  {textItalic}
  {textBgEnabled}
  {textBgColor}
  {textBgOpacity}
  {textBorderWidth}
  {textBorderColor}
  onSelectItem={selectQueueItem}
/>
```
Add import: `import TableEditor from '$lib/components/TableEditor.svelte';`

Remove the inline `getTableData`, `updateTableText`, `addTableRow`, `deleteTableRow` functions from the script block.

- [ ] **Step 3: Verify build**

Run: `npm run check`

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/TableEditor.svelte src/routes/+page.svelte
git commit -m "refactor: extract TableEditor.svelte from monolith"
```

---

### Task 11: Extract BatchPanel.svelte — Template + batch controls

**Files:**
- Create: `src/lib/components/BatchPanel.svelte`
- Modify: `src/routes/+page.svelte` (~L1620-1690 inline batch sidebar section)

- [ ] **Step 1: Create BatchPanel.svelte**

```svelte
<!-- src/lib/components/BatchPanel.svelte -->
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
      <div class="text-[9px] mt-0.5" style="color:var(--text-muted)">Dibuja regiones y pulsa "Anadir region".</div>
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
      Anadir region text{nextRegionLabel}
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
```

- [ ] **Step 2: Replace inline batch section in +page.svelte**

Replace the `{#if sidebarMode === 'batch'}` block with:
```svelte
{#if sidebarMode === 'batch'}
  <BatchPanel
    {selectedIdx}
    bind:templateIdx
    bind:templateRegions
    bind:nextRegionLabel
    {region}
    bind:batchFindText
    bind:batchReplaceText
    bind:batchFindScope
    onAddTemplateRegion={addTemplateRegion}
    onRemoveTemplateRegion={removeTemplateRegion}
    onSetTemplate={setTemplate}
    onImportExcel={importExcelBulk}
    onOpenTableEditor={() => showTableEditor = true}
    onBatchFindReplace={batchFindReplace}
  />
{/if}
```
Add import: `import BatchPanel from '$lib/components/BatchPanel.svelte';`

- [ ] **Step 3: Verify build**

Run: `npm run check`

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/BatchPanel.svelte src/routes/+page.svelte
git commit -m "refactor: extract BatchPanel.svelte template/batch controls"
```

---

### Task 12: Extract PropertyPanel.svelte — Right sidebar

**Files:**
- Create: `src/lib/components/PropertyPanel.svelte`
- Modify: `src/routes/+page.svelte` (~L1500-1790, the entire right sidebar)

- [ ] **Step 1: Create PropertyPanel.svelte**

```svelte
<!-- src/lib/components/PropertyPanel.svelte -->
<script lang="ts">
  import type { QueueItem, SidebarMode, TextRegion } from '$lib/types';
  import type { Region, Operation } from '$lib/video-utils';
  import StyleEditor from './StyleEditor.svelte';
  import PresetManager, { type TextPreset } from './PresetManager.svelte';
  import BatchPanel from './BatchPanel.svelte';
  import LayerList from './LayerList.svelte';

  let {
    selected,
    sidebarMode = $bindable('logo'),
    region = $bindable(null),
    blurStrength = $bindable(20),
    textInput = $bindable('Sample Text'),
    textFontSize = $bindable(32),
    textFontColor = $bindable('white'),
    textFontFamily = $bindable('Arial'),
    textBold = $bindable(false),
    textItalic = $bindable(false),
    textBgEnabled = $bindable(true),
    textBgColor = $bindable('black'),
    textBgOpacity = $bindable(0.65),
    textBorderWidth = $bindable(0),
    textBorderColor = $bindable('black'),
    tempStart = $bindable(null),
    tempEnd = $bindable(null),
    activeTool,
    selectedIdx,
    templateIdx = $bindable(-1),
    templateRegions = $bindable([]),
    nextRegionLabel = $bindable(1),
    batchFindText = $bindable(''),
    batchReplaceText = $bindable(''),
    batchFindScope = $bindable<'selected' | 'all'>('selected'),
    presets = $bindable([]),
    onAddOperation,
    onCancelRegion,
    onAutoPosition,
    onAutoTextColor,
    onRemoveOp,
    onMoveOp,
    onDuplicateOp,
    onEditOpRegion,
    onApplyStyleToOp,
    onClearOps,
    onAddTemplateRegion,
    onRemoveTemplateRegion,
    onSetTemplate,
    onImportExcel,
    onOpenTableEditor,
    onBatchFindReplace,
  }: {
    selected: QueueItem | null;
    sidebarMode?: SidebarMode;
    region?: Region | null;
    blurStrength?: number;
    textInput?: string;
    textFontSize?: number;
    textFontColor?: string;
    textFontFamily?: string;
    textBold?: boolean;
    textItalic?: boolean;
    textBgEnabled?: boolean;
    textBgColor?: string;
    textBgOpacity?: number;
    textBorderWidth?: number;
    textBorderColor?: string;
    tempStart?: number | null;
    tempEnd?: number | null;
    activeTool: 'blur' | 'crop' | 'text';
    selectedIdx: number;
    templateIdx?: number;
    templateRegions?: TextRegion[];
    nextRegionLabel?: number;
    batchFindText?: string;
    batchReplaceText?: string;
    batchFindScope?: 'selected' | 'all';
    presets?: TextPreset[];
    onAddOperation: (mode: string) => void;
    onCancelRegion: () => void;
    onAutoPosition: (mode: 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right') => void;
    onAutoTextColor: () => void;
    onRemoveOp: (idx: number) => void;
    onMoveOp: (idx: number, dir: -1 | 1) => void;
    onDuplicateOp: (idx: number) => void;
    onEditOpRegion: (idx: number) => void;
    onApplyStyleToOp: (idx: number) => void;
    onClearOps: () => void;
    onAddTemplateRegion: () => void;
    onRemoveTemplateRegion: (id: number) => void;
    onSetTemplate: (idx: number) => void;
    onImportExcel: () => void;
    onOpenTableEditor: () => void;
    onBatchFindReplace: () => void;
  } = $props();

  let presetManager = $state<PresetManager>();

  export function loadPresets() { presetManager?.loadFromStorage(); }
</script>

{#if selected}
  <aside class="cap-sidebar cap-sidebar-right overflow-y-auto">
    <div class="cap-section !pb-3">
      <div class="cap-mode-tabs">
        <button onclick={() => sidebarMode = 'logo'} class="cap-mode-tab {sidebarMode === 'logo' ? 'active-logo' : ''}">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9.53 16.122a3 3 0 00-5.78 1.128 2.25 2.25 0 01-2.4 2.245 4.5 4.5 0 008.4-2.245c0-.399-.078-.78-.22-1.128zm0 0a15.364 15.364 0 018.466-6.282 3 3 0 00-4.242-4.243 15.364 15.364 0 00-6.282 8.466 3 3 0 004.242 4.243"/></svg>
          Quitar logo
        </button>
        <button onclick={() => sidebarMode = 'batch'} class="cap-mode-tab {sidebarMode === 'batch' ? 'active-batch' : ''}">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 01-1.125-1.125M3.375 19.5h7.5c.621 0 1.125-.504 1.125-1.125m-9.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-13.5V5.625m0 0h-7.5m7.5 0v1.5c0 .621-.504 1.125-1.125 1.125M3.375 8.25c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m17.25-3.75h-7.5"/></svg>
          Texto en lote
        </button>
      </div>
    </div>

    <div class="cap-section">
      <div class="cap-section-title">
        Region · <span class="normal-case tracking-normal font-normal" style="color:var(--text-secondary)">{selected.filename}</span>
      </div>

      {#if region}
        <div class="grid grid-cols-2 gap-2 mb-3">
          {#each ([['X','x'],['Y','y'],['W','w'],['H','h']] as const) as [label, key]}
            <label>
              <span class="cap-input-label">{label}</span>
              <input type="number" value={Math.round(region[key])}
                onchange={(e) => { region = { ...region!, [key]: parseInt((e.target as HTMLInputElement).value) || 0 }; }}
                class="cap-input font-mono text-[11px]" />
            </label>
          {/each}
        </div>

        {#if sidebarMode === 'logo'}
          <div class="mb-3">
            <label class="flex items-center gap-2 text-[10px]" style="color:var(--text-muted)">
              Intensidad blur
              <input type="range" min="2" max="60" bind:value={blurStrength} class="flex-1" />
              <span class="font-mono text-xs w-6 text-right" style="color:var(--accent)">{blurStrength}</span>
            </label>
          </div>
        {/if}

        <div class="mb-3 space-y-2">
          {#if sidebarMode === 'logo'}
            <label>
              <span class="cap-input-label">Contenido de texto</span>
              <input type="text" bind:value={textInput} placeholder="Escribe aqui..." class="cap-input" />
            </label>
          {:else}
            <div class="cap-card cap-card-batch text-[10px] leading-relaxed" style="color:rgba(168,85,247,0.85)">
              La region dibujada define posicion y tamano. El texto se cargara desde Excel.
            </div>
          {/if}

          <StyleEditor
            bind:fontFamily={textFontFamily}
            bind:bold={textBold}
            bind:italic={textItalic}
            bind:fontSize={textFontSize}
            bind:fontColor={textFontColor}
            bind:bgEnabled={textBgEnabled}
            bind:bgColor={textBgColor}
            bind:bgOpacity={textBgOpacity}
            bind:borderWidth={textBorderWidth}
            bind:borderColor={textBorderColor}
          />
        </div>

        <PresetManager
          bind:this={presetManager}
          bind:presets
          currentStyle={() => ({
            name: '', fontFamily: textFontFamily, bold: textBold, italic: textItalic,
            fontSize: textFontSize, fontColor: textFontColor, bgEnabled: textBgEnabled,
            bgColor: textBgColor, bgOpacity: textBgOpacity, borderWidth: textBorderWidth,
            borderColor: textBorderColor,
          })}
          onApply={(p) => {
            textFontFamily = p.fontFamily; textBold = p.bold; textItalic = p.italic;
            textFontSize = p.fontSize; textFontColor = p.fontColor; textBgEnabled = p.bgEnabled;
            textBgColor = p.bgColor; textBgOpacity = p.bgOpacity; textBorderWidth = p.borderWidth;
            textBorderColor = p.borderColor;
          }}
        />

        {#if sidebarMode === 'logo'}
          <div class="grid grid-cols-2 gap-2 mb-3">
            <label>
              <span class="cap-input-label">Inicio (s)</span>
              <input type="number" bind:value={tempStart} placeholder="0" class="cap-input font-mono text-[11px]" />
            </label>
            <label>
              <span class="cap-input-label">Fin (s)</span>
              <input type="number" bind:value={tempEnd} placeholder="final" class="cap-input font-mono text-[11px]" />
            </label>
          </div>
        {/if}
        <div class="mb-2">
          <button onclick={() => onAddOperation(activeTool)}
            class="cap-btn-apply {activeTool === 'blur' ? 'cap-btn-apply-blur' : activeTool === 'crop' ? 'cap-btn-apply-crop' : 'cap-btn-apply-text'}">
            Aplicar {activeTool === 'blur' ? 'Desenfoque' : activeTool === 'crop' ? 'Recorte' : 'Texto'}
          </button>
        </div>
        <button onclick={onCancelRegion} class="text-[10px] mb-3 hover:underline" style="color:var(--text-muted)">Cancelar seleccion</button>
        <div class="mb-3">
          <div class="cap-input-label mb-1.5">Posicion automatica</div>
          <div class="grid grid-cols-5 gap-1">
            <button onclick={() => onAutoPosition('top-left')} class="cap-btn-icon !w-full" title="Arriba izq">↖</button>
            <button onclick={() => onAutoPosition('center')} class="cap-btn-icon !w-full" title="Centro">⊕</button>
            <button onclick={() => onAutoPosition('top-right')} class="cap-btn-icon !w-full" title="Arriba der">↗</button>
            <button onclick={() => onAutoPosition('bottom-left')} class="cap-btn-icon !w-full" title="Abajo izq">↙</button>
            <button onclick={() => onAutoPosition('bottom-right')} class="cap-btn-icon !w-full" title="Abajo der">↘</button>
          </div>
          <button onclick={onAutoTextColor} class="cap-btn-secondary w-full mt-1.5 text-[10px] !py-1.5">
            Color automatico (contraste)
          </button>
        </div>
      {:else}
        <div class="text-[11px] mb-4 leading-relaxed cap-card cap-card-info" style="color:var(--text-secondary)">
          Dibuja un rectangulo sobre el video para seleccionar el area. Ajusta con los handles o los valores numericos.
        </div>
      {/if}

      {#if sidebarMode === 'batch'}
        <BatchPanel
          {selectedIdx}
          bind:templateIdx
          bind:templateRegions
          bind:nextRegionLabel
          {region}
          bind:batchFindText
          bind:batchReplaceText
          bind:batchFindScope
          onAddTemplateRegion={onAddTemplateRegion}
          onRemoveTemplateRegion={onRemoveTemplateRegion}
          onSetTemplate={onSetTemplate}
          onImportExcel={onImportExcel}
          onOpenTableEditor={onOpenTableEditor}
          onBatchFindReplace={onBatchFindReplace}
        />
      {/if}
    </div>

    <LayerList
      bind:operations={selected.operations}
      onRemove={onRemoveOp}
      onMove={onMoveOp}
      onDuplicate={onDuplicateOp}
      onEditRegion={onEditOpRegion}
      onApplyStyle={onApplyStyleToOp}
      onClearOps={onClearOps}
      onStyleTextOp={onApplyStyleToOp}
    />
  </aside>
{/if}
```

- [ ] **Step 2: Replace the entire right sidebar in +page.svelte**

Replace the entire `{#if selected}<aside class="cap-sidebar cap-sidebar-right">...</aside>{/if}` block with:
```svelte
<PropertyPanel
  {selected}
  bind:sidebarMode
  bind:region
  bind:blurStrength
  bind:textInput
  bind:textFontSize
  bind:textFontColor
  bind:textFontFamily
  bind:textBold
  bind:textItalic
  bind:textBgEnabled
  bind:textBgColor
  bind:textBgOpacity
  bind:textBorderWidth
  bind:textBorderColor
  bind:tempStart
  bind:tempEnd
  {activeTool}
  {selectedIdx}
  bind:templateIdx
  bind:templateRegions
  bind:nextRegionLabel
  bind:batchFindText
  bind:batchReplaceText
  bind:batchFindScope
  bind:presets
  onAddOperation={addOperation}
  onCancelRegion={() => { region = null; drawRegion(); }}
  onAutoPosition={autoPositionText}
  onAutoTextColor={autoTextColor}
  onRemoveOp={removeOp}
  onMoveOp={moveOp}
  onDuplicateOp={duplicateOp}
  onEditOpRegion={editOpRegion}
  onApplyStyleToOp={applyStyleToOp}
  onClearOps={clearOps}
  onAddTemplateRegion={addTemplateRegion}
  onRemoveTemplateRegion={removeTemplateRegion}
  onSetTemplate={setTemplate}
  onImportExcel={importExcelBulk}
  onOpenTableEditor={() => showTableEditor = true}
  onBatchFindReplace={batchFindReplace}
/>
```
Add import: `import PropertyPanel from '$lib/components/PropertyPanel.svelte';`

- [ ] **Step 3: Verify build**

Run: `npm run check`

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/PropertyPanel.svelte src/routes/+page.svelte
git commit -m "refactor: extract PropertyPanel.svelte right sidebar"
```

---

### Task 13: Extract ToolBar.svelte

**Files:**
- Create: `src/lib/components/ToolBar.svelte`
- Modify: `src/routes/+page.svelte` (~L1495-1510)

- [ ] **Step 1: Create ToolBar.svelte**

```svelte
<!-- src/lib/components/ToolBar.svelte -->
<script lang="ts">
  let {
    activeTool = $bindable('blur'),
    visible = true,
  }: {
    activeTool?: 'blur' | 'crop' | 'text';
    visible?: boolean;
  } = $props();
</script>

{#if visible}
  <div class="cap-toolbar shrink-0">
    <button onclick={() => activeTool = 'blur'} class="cap-tool-btn {activeTool === 'blur' ? 'active-blur' : ''}">
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9-4.03-9-9-9zm0 0v18M3 12h18"/></svg>
      Desenfoque
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
```

- [ ] **Step 2: Replace inline toolbar in +page.svelte**

Replace the `{#if selected && sidebarMode === 'logo'}<div class="cap-toolbar">...</div>{/if}` block with:
```svelte
<ToolBar bind:activeTool visible={!!selected && sidebarMode === 'logo'} />
```
Add import: `import ToolBar from '$lib/components/ToolBar.svelte';`

- [ ] **Step 3: Verify build**

Run: `npm run check`

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/ToolBar.svelte src/routes/+page.svelte
git commit -m "refactor: extract ToolBar.svelte from monolith"
```

---

### Task 14: Final cleanup and verify +page.svelte size reduction

**Files:**
- Modify: `src/routes/+page.svelte` (cleanup orphaned code, verify line count)

- [ ] **Step 1: Remove orphaned code from +page.svelte**

After all extractions, the script block should only contain:
- Queue state (`queue`, `selectedIdx`, `isProcessingAll`, `batchSummary`)
- Canvas/video state (`videoEl`, `canvas`, `region`, drawing/resizing state)
- Text style state variables (bound to PropertyPanel)
- Drag/drop handlers (`onDragEnter`, `onDragOver`, `onDragLeave`, `onDrop`)
- Canvas interaction functions (`contentRect`, `toVideo`, `onCanvasDown/Move/Up/MouseDown/MouseMove`, `hitTest*`, `doResize`, `doOpResize`)
- `addVideo`, `addVideoFromPaths`, `selectQueueItem`, `removeQueueItem`
- `addOperation`, `processAll`, `cancelAll`, `applyToAll`
- `drawRegion`, `fitCanvas`, `regionToScreen`, `cssFontFamily`
- Auto-save/load logic
- Keyboard handler

Remove any functions/types/state that were moved to child components and are no longer referenced in the template.

- [ ] **Step 2: Verify line count**

Run: `(Get-Content "src/routes/+page.svelte").Count`
Expected: Under 800 lines (down from 1937)

- [ ] **Step 3: Run full type check**

Run: `npm run check`
Expected: No errors

- [ ] **Step 4: Run existing tests**

Run: `npm run test`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add src/routes/+page.svelte
git commit -m "refactor: cleanup orphaned code after component extraction"
```

---

## Verification Checklist

After all tasks:

- [ ] `npm run check` passes (no type errors)
- [ ] `npm run test` passes (existing tests still work)
- [ ] `npm run build` produces working build
- [ ] +page.svelte is under 800 lines
- [ ] Each component has a single clear responsibility
- [ ] No duplicated logic between components
- [ ] All keyboard shortcuts still work (Ctrl+Z, Ctrl+Y, Ctrl+O, ?, Esc)
- [ ] Drag & drop still works
- [ ] Batch processing still works
- [ ] Table editor still works
- [ ] Presets still load from localStorage
- [ ] Auto-save still works
