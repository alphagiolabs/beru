# Plan: restos de simplificación (media / baja)

Auditoría de lo que quedó sin tocar tras las rondas de `/simplificar`. Objetivo: menos código, mismo comportamiento observable. Nada de esto es un bugfix de producto salvo donde se indica.

Fuente: conversación de simplificación 2026-09-07 y el código actual del working tree.

## Veredicto

| Ítem                                                                 | Decisión                               | Por qué                                                                                                                                                                                                                  |
| -------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `StatusFooter` selector `queueLength`                                | **No tocar**                           | `tests/status-footer.test.jsx` exige re-render cuando solo cambia la longitud de la cola. `getBatchProgress` lee `get().queue`; sin la suscripción el pie no se actualiza.                                               |
| `Header` deps de capacidad                                           | **Hacer (fase 1)**                     | El efecto usa `get().queue` pero depende de `queueLength`. Añadir `get` es incorrecto. Hay que suscribir un derivado (`maxSourcePixels`, `hasVideoFilters`). Hoy, añadir un op a un video existente no refresca el hint. |
| `getIsProcessing`                                                    | **No tocar**                           | Es el flag del lock. `hasActiveProcessing` también mira `runId` y el child. Los tests del watchdog miden el lock, no el OR.                                                                                              |
| `useCanvas` vs `applyResize`/`applyMove`                             | **Hacer (fase 3, con prueba primero)** | La aritmética de handles es la misma. Canvas resize **no** clampea; `applyResize` sí. Unificar sin tests cambia el gesto en el borde.                                                                                    |
| `contentRect` vs `contentRectLayout`                                 | **Hacer (fase 1)**                     | Extraer letterbox compartido. Mantener las dos APIs públicas: una usa `getBoundingClientRect` (puntero), la otra `offsetWidth` (layout/zoom).                                                                            |
| `hasVideoDimensions` renderer/main                                   | **Hacer (fase 1)**                     | Misma expresión en `src/utils/batch-process.js` y `main/videoProbe.js`. Mover a `shared/`.                                                                                                                               |
| Wrappers Python `_is_hardware_*` etc.                                | **No tocar**                           | Se llaman en el batch. Son la superficie de monkeypatch de `processor.py`. Inlinear no ahorra comportamiento y rompe el contrato de tests históricos.                                                                    |
| APIs sync processor/input                                            | **Hacer (fase 2)**                     | Producción usa async. Sync solo vive en tests. Migrar tests y borrar sync.                                                                                                                                               |
| `loadPresetsFromStorage`                                             | **Hacer (fase 2)**                     | Nadie escribe `beru-presets`. Es caché huérfana del `savePreset` sync borrado. Boot debe usar archivos; localStorage solo como migración one-shot y luego borrar la clave.                                               |
| `watermarkSlice(set, get)`                                           | **No tocar**                           | Convención de todas las slices. `get` no se lee. Cambiar solo esta firma es ruido.                                                                                                                                       |
| Fallbacks `resolvePreviewText`                                       | **Hacer (fase 1)**                     | El store real siempre tiene `getBatchPreviewText`. El test de preview ya lo pasa. Quitar `getCellTextForRegion`; conservar fallback de `tr.label`.                                                                       |
| Pickers de posición                                                  | **No unificar números**                | Cuatro sistemas distintos (región imagen 0.02/0.98, texto 5 celdas, tabla 0.05/0.3/0.55, watermark CSS). Unificar es decisión de producto, no dead code.                                                                 |
| `shadcn` en `package.json`                                           | **Fase 4 opcional**                    | CLI, no import runtime. `components.json` existe; el único primitive es `dropdown-menu.jsx`. `clsx`/`tailwind-merge` sí se usan. Geist/cva/tw-animate-css ya no están.                                                   |
| Deps de efectos (TableEditor, TextOverlay, VideoPreview, useZoomPan) | **No tocar**                           | Añadir deps cambia cuándo se mide, se resetea preview o se limpia zoom. No es código muerto.                                                                                                                             |

## Decisiones de diseño

1. **No añadir `get` a arrays de deps.** Si un efecto lee el store con `get()`, suscribir el valor derivado que importa.
2. **No mezclar APIs de letterbox.** Extraer la cuenta, no fusionar `contentRect` y `contentRectLayout`.
3. **Canvas: clamp es un cambio de gesto.** Fase 3 solo después de un test que fije el comportamiento actual (sin clamp en resize) o de una decisión explícita de clampear.
4. **Python: no inlinear wrappers.** Conservar nombres en `processor.py`.
5. **Presets: disco es la fuente de verdad.** `localStorage["beru-presets"]` es migración, no caché viva.

## Fase 1 — DRY seguro, sin cambio de gesto

Cada tarea deja tests verdes. Orden: 1 → 2 → 3 → 4. 1 y 2 pueden ir en paralelo.

### Task 1: Extraer letterbox compartido

**Qué:** Una función pura `letterboxContent(containerW, containerH, videoW, videoH)` que devuelve `{ dw, dh, ox, oy }`. `contentRect` y `contentRectLayout` la llaman.

**No hacer:** Unificar las dos funciones públicas ni cambiar qué medida de contenedor usa cada una.

**Criterios:**

- [ ] `contentRect` sigue usando `getBoundingClientRect` y expone `br`.
- [ ] `contentRectLayout` sigue usando `offsetWidth`/`offsetHeight` y expone `width`/`height`.
- [ ] Mismos resultados numéricos que hoy para un video 16:9 en un rect 800×450 y en pillarbox.
- [ ] `tests/text-region-interaction.test.js` pasa sin cambiar aserciones.

**Archivos:** `src/utils/video-utils.js`, opcionalmente `tests/text-region-interaction.test.js` si hace falta un caso del helper.

**Verificación:** `npx vitest run tests/text-region-interaction.test.js tests/text-canvas-paint.test.js`

**Scope:** S

### Task 2: `hasVideoDimensions` en `shared/`

**Qué:** Mover la expresión `Number(item?.width \|\| 0) > 0 && Number(item?.height \|\| 0) > 0` a `shared/video-dimensions.js`. Importar desde renderer (`batch-process.js`) y main (`videoProbe.js`). Reexportar desde `batch-process.js` para no romper imports existentes.

**Criterios:**

- [ ] Un solo cuerpo de la función.
- [ ] `tests/batch-process.test.js` y `tests/main.videoProbe.test.js` siguen pasando.
- [ ] `package.json` `build.files` ya incluye `shared/**/*`.

**Archivos:** `shared/video-dimensions.js` (nuevo), `src/utils/batch-process.js`, `main/videoProbe.js`.

**Verificación:** `npx vitest run tests/batch-process.test.js tests/main.videoProbe.test.js tests/video-dimensions.test.js`

**Scope:** S

### Task 3: Hint de workers sin `get` en deps

**Qué:** En `Header`, suscribir un objeto derivado del queue (no `get()`):

```js
const capacityInput = useEditorStore(
  (s) => ({
    queueLength: s.queue.length,
    maxSourcePixels: /* max de sourceWidth*sourceHeight o width*height */,
    hasVideoFilters:
      s.templateRegions.length > 0 || s.queue.some((item) => (item.operations || []).length > 0),
  }),
  shallow,
);
```

Deps del efecto: `[capacityInput.queueLength, capacityInput.maxSourcePixels, capacityInput.hasVideoFilters, encodeProfile]`. Debounce 200 ms se mantiene.

**No hacer:** Meter `get` en el array de deps.

**Criterios:**

- [ ] Cambiar solo la longitud de la cola sigue refrescando el hint.
- [ ] Añadir una operación a un ítem existente también refresca (hoy no).
- [ ] Cambiar solo `customOutputName` no dispara un IPC extra (shallow / valores primitivos).
- [ ] El debounce de 200 ms se conserva.

**Archivos:** `src/components/Header.jsx`, test nuevo o extensión de `tests/header-export.test.jsx` / `tests/header-batch-summary.test.jsx`.

**Verificación:** `npx vitest run tests/header-export.test.jsx tests/header-batch-summary.test.jsx tests/app-render.test.jsx`

**Scope:** S–M. Esto sí cambia cuándo se pide capacidad (más a menudo, de forma correcta).

### Task 4: Adelgazar `resolvePreviewText`

**Qué:** Dejar:

1. `state.getBatchPreviewText` si es función.
2. Si no, `tr.label || "Texto de ejemplo"`.

Borrar el ramo `getCellTextForRegion`. El store de producción siempre define `getBatchPreviewText`. El test actual ya inyecta esa función.

**Criterios:**

- [ ] `tests/batch-text-ops.test.js` y `tests/preview-frame.test.js` pasan sin ampliar stubs.
- [ ] Preview con celda Excel vacía sigue mostrando el label de la región.

**Archivos:** `src/utils/batch-text-ops.js`.

**Verificación:** `npx vitest run tests/batch-text-ops.test.js tests/preview-frame.test.js`

**Scope:** XS

### Checkpoint fase 1

- [ ] `npm run lint`
- [ ] `npm run format:check`
- [ ] `npm test`

## Fase 2 — APIs duales y migración

Secuencial: 5 y 6 independientes entre sí.

### Task 5: Borrar APIs sync de spawn / input validation

**Qué:** Producción ya usa `validateProcessorAvailableAsync` y `findUnreadableInputsAsync`. Migrar:

- `tests/runtime-dependencies.test.js` → solo async (`resolveProcessorSpawnAsync`, `validateProcessorAvailableAsync`).
- `tests/process-input-validation.test.js` → `findUnreadableInputsAsync` / `validateInputPathReadableAsync`.

Luego borrar exports sync: `resolveProcessorSpawn`, `validateProcessorAvailable`, `validateInputPathReadable`, `findUnreadableInputs`.

**Criterios:**

- [ ] Ningún caller de producción usa las variantes sync (confirmar con `rg` en `main/`, `scripts/`).
- [ ] Los tests async cubren los mismos casos (ok, missing, unreadable, orden).
- [ ] `preview-frame.js` y `process.js` siguen en async.

**Archivos:** `main/utils/processor-spawn.js`, `main/utils/process-input-validation.js`, los dos tests.

**Verificación:** `npx vitest run tests/runtime-dependencies.test.js tests/process-input-validation.test.js tests/preview-frame.test.js tests/main-quit-during-probe.test.js`

**Scope:** M

### Task 6: Presets — disco primero, localStorage one-shot

**Qué:** Hoy `App` llama `loadPresetsFromStorage()` y nunca `loadPresets()` hasta abrir el menú. Nadie escribe `beru-presets`.

Plan de comportamiento:

1. En boot, `loadPresets()` (IPC `presets:list`) es la fuente.
2. Si `localStorage["beru-presets"]` existe **y** la lista de disco está vacía, hidratar una vez y `removeItem("beru-presets")`.
3. Si el disco tiene presets, ignorar y borrar la clave.
4. Quitar `loadPresetsFromStorage` como acción pública si ya no tiene callers.

**Criterios:**

- [ ] Usuario con presets en `userData` no pierde la librería.
- [ ] Usuario con solo JSON viejo en localStorage lo ve una vez y la clave desaparece.
- [ ] `tests/store.savePreset.test.js` y `tests/store.deletePreset.test.js` siguen verdes.
- [ ] No reintroducir escritura a `beru-presets`.

**Archivos:** `src/App.jsx`, `src/stores/slices/projectSlice.js`, tests de store.

**Verificación:** `npx vitest run tests/store.savePreset.test.js tests/store.deletePreset.test.js tests/app-render.test.jsx tests/store.logic.test.js`

**Scope:** M

### Checkpoint fase 2

- [ ] `npm run lint && npm run format:check && npm test`

## Fase 3 — Gestos del canvas (solo con prueba)

### Task 7a: Fijar el comportamiento actual de resize en canvas

**Qué:** Tests de `useCanvas` o de `applyPointerMove` (extraer la aritmética a una función testeable si el hook es difícil) que cubran:

- Resize `br` crece.
- Resize `tl` con delta que dejaría `w < 0.01` se queda en min size.
- Resize que empujaría `x+w > 1` **hoy no clampea** (documentar el valor actual).

**Criterios:**

- [ ] Test rojo si se cambia el clamp accidentalmente.
- [ ] No cambia producto.

**Archivos:** `tests/text-region-interaction.test.js` o `tests/use-canvas-resize.test.js`, posiblemente extraer helper desde `useCanvas.js`.

**Verificación:** el test nuevo.

**Scope:** S

### Task 7b: Decisión de clamp, luego unificar

**Qué:** Con 7a en verde, elegir:

- **A (conservador):** extraer la aritmética de handles a `applyResize` pero **sin** `clampRegionToVideo` en el camino canvas (o un flag `clamp=false`). Canvas y DOM (`useRegionGesture`) pueden seguir divergiendo en el borde.
- **B (unificar de verdad):** canvas también clampea. Es un cambio de gesto. Requiere el test de 7a actualizado a los valores clampados y una pasada manual: blur/crop/delogo resize contra el borde del video.

No implementar 7b hasta que 7a exista. Preferir A si no hay OK de producto para B.

**Archivos:** `src/hooks/useCanvas.js`, `src/utils/region-interaction.js`, tests de región.

**Verificación:** tests de 7a + `tests/text-region-interaction.test.js` + `tests/region-interaction.test.js`

**Scope:** M

### Checkpoint fase 3

- [ ] `npm test`
- [ ] Si se eligió B: probar en Electron resize de blur/delogo contra cada borde.

## Fase 4 — Opcional / no hacer

### Task 8 (opcional): `shadcn` CLI

**Qué:** Comprobar si el flujo `npx shadcn add` se usa. Si no, se puede sacar `shadcn` de `devDependencies`. **No** tocar `clsx` ni `tailwind-merge` (`src/lib/utils.js` + dropdown).

**Criterios:** `rg shadcn` en scripts y CI vacío; `npm ls shadcn` solo CLI; lockfile actualizado en el mismo commit.

**No es simplificación de producto.** Solo DX.

### Explicitamente fuera

- Unificar pickers de posición (imagen / texto / tabla / watermark).
- Inlinear wrappers de `processor.py`.
- Quitar `getIsProcessing`.
- Quitar `queueLength` del selector de `StatusFooter`.
- Añadir `queue` / `screen` / `scaleY` / `videoRef` a deps de efectos existentes.
- Cambiar `createWatermarkSlice(set, get)`.
- Reintroducir o borrar Geist / cva / tw-animate-css (ya no están).

## Riesgos

| Riesgo                                                          | Impacto | Mitigación                                                                                                                                  |
| --------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Task 3 dispara más IPC `getBatchCapacity`                       | Medio   | Debounce 200 ms; derivado con primitivos, no el array `queue`.                                                                              |
| Task 6 pierde presets de un usuario solo-localStorage           | Alto    | Migración one-shot antes de borrar la clave; test con fixture de `beru-presets`.                                                            |
| Task 5 borra sync que un script no testeado usa                 | Bajo    | `rg` en `main/`, `scripts/`, `tests/` antes de borrar.                                                                                      |
| Task 7b cambia el resize en el borde                            | Alto    | No unificar clamp sin 7a y sin OK.                                                                                                          |
| `shared/video-dimensions.js` vs `src/utils/video-dimensions.js` | Bajo    | Nombre distinto o reexport claro. Ya existe `src/utils/video-dimensions.js` (`getLockedDimensions`). Usar `shared/has-video-dimensions.js`. |

## Orden y paralelismo

```
Task 1 ──┐
Task 2 ──┼── checkpoint 1
Task 3 ──┤
Task 4 ──┘
Task 5 ──┐
Task 6 ──┴── checkpoint 2
Task 7a ──── Task 7b (si hay OK)
Task 8 opcional
```

1–4 en paralelo. 5 y 6 en paralelo después. 7b bloqueada por 7a.

## Gate del repo (todas las fases)

Tras cada fase, no al final del plan entero:

```
npm run lint
npm run format:check
npm test
npm run test:python   # solo fase 2 si se toca python (esta plan no toca python salvo que se ignore la regla de wrappers)
```
