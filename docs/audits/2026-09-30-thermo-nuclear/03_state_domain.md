# Auditoría termo-nuclear — estado y dominio (renderer + shared)

Fecha: 2026-09-30. Alcance: `src/stores/`, `src/utils/`, `src/theme/`, `src/hooks/`, `src/lib/`, `src/i18n/` y `shared/` (raíz). Auditoría de solo lectura sobre código fuente; no se modificó ningún archivo fuente. Los componentes fuera de alcance se citan solo como evidencia de consumo.

## Mediciones

### Stores (`src/stores/`)

| Archivo                      | Líneas | Notas                                                                                                |
| ---------------------------- | -----: | ---------------------------------------------------------------------------------------------------- |
| `slices/queueSlice.js`       |    717 | queue CRUD + undo/redo + thumbnails + caché de imágenes + `currentRegion` + servicio de output paths |
| `slices/batchSlice.js`       |    630 | template regions + Excel (import/mapping/sync) + 2 flags de modal                                    |
| `slices/uiSlice.js`          |    410 | tema (slots+custom+migración) + idioma + recents + updater + modales + toasts + confirm              |
| `slices/petSlice.js`         |    405 | dominio pets completo (settings, manifest, install, overlay sync)                                    |
| `slices/processingSlice.js`  |    327 | ciclo de vida del run + progreso + settings de encode                                                |
| `slices/projectSlice.js`     |    274 | serialización proyecto/preset + apply                                                                |
| `slices/authSlice.js`        |    239 | Supabase auth + admin                                                                                |
| `slices/editorStyleSlice.js` |     78 | tool + defaults de texto/delogo + inputs temporales + `outputDir`                                    |
| `slices/watermarkSlice.js`   |     22 | objeto watermark + flag de modal                                                                     |
| `useEditorStore.js`          |     73 | composición + restauración + persistencia debounced                                                  |

Total stores: ~3 175 líneas, 9 slices.

### Utils / theme / hooks / shared

| Archivo                                   |  Líneas | Clase                                                                                                               |
| ----------------------------------------- | ------: | ------------------------------------------------------------------------------------------------------------------- |
| `theme/presets.js`                        |     950 | **datos puros**: 44 presets × 15 tokens + `getPresetById`/`isPresetId`                                              |
| `utils/types.js`                          |     897 | grab-bag: math de regiones + `uid` + `createQueueItem` + catálogos UI + `TEXT_STYLE_PRESETS` (~700 líneas de datos) |
| `utils/export-pipeline.js`                |     268 | reducers puros de progreso/estado de jobs + `buildExportJob`                                                        |
| `utils/video-utils.js`                    |     249 | geometría de regiones + canvas paint + `fmtTime` + match-id/rowGet                                                  |
| `theme/engine.js`                         |     249 | refs preset/custom + validación + apply + migración de settings                                                     |
| `utils/text-style.js`                     |     241 | claves/defaults/normalización/payload Python de estilo de texto                                                     |
| `utils/text-layout.js`                    |     189 | wrap/fit/truncate + catálogos de alineación                                                                         |
| `utils/session-persist.js`                |     152 | snapshot whitelist con `SESSION_PERSIST_FIELDS`                                                                     |
| `utils/export-run.js` + `batch-runner.js` |     204 | `prepareRun`/`finishRun` + `runBatch`/`runSingle`/`cancelBatch`                                                     |
| `utils/delogo-render-*`                   |    ~280 | kernels puros + worker + bridge (bien factorizado)                                                                  |
| `shared/job-manifest.js`                  |      88 | `normalizeJob`/`normalizeManifest` — contrato explícito                                                             |
| `shared/ipc-channels.js`                  |      92 | tabla IPC + `RUN_SCOPED_CHANNELS` + `emitRunEvent`                                                                  |
| `shared/project-document.js`              |      39 | `isProjectOrPreset` + `validateProjectDocument`                                                                     |
| `i18n/messages/*.json`                    | 599+599 | 594 claves por idioma, paridad exacta (verificado)                                                                  |
| `hooks/*`                                 |    ~760 | useCanvas(272)/useKeyboard(199)/useProcessing(139)/useRegionGesture(113)/useUpdater(59)/useCloseOnOutsideClick(19)  |

Ningún export es realmente dead: los ~200 nombres chequeados por grep tienen consumidor o test. Sí hay varias acciones "públicas pero internas" (`initPets`, `loadInstalledPets`, `buildPetOverlayPayload`, `syncAllOperationsToExcel`, `createTextOpForRegion`, `updateOperationText`, `contentRectLayout`, `normalizeRegion`) — solo se llaman desde su propio módulo o tests, conviviendo con la convención `_privada` que el mismo código sí usa para otras (`_saveUndo`, `_reapplyExcel`, `_applyProject`).

---

## Hallazgos (ordenados por severidad)

### 1. `tempImageScale`: estado + control de UI que no llegan a ninguna parte (defecto funcional / dead feature)

`tempImageScale` y `setTempImageScale` existen en el store (`editorStyleSlice.js:29,57`), el slider se renderiza y muta (`PropertiesPanel.jsx:331-353` — `value={tempImageScale || 1}`), pero **ningún consumidor lee el campo**: `addOperation` copia `tempImagePath`/`tempImageOpacity` a la op (`queueSlice.js:521-522`) y nada más; `createOperation` (`operation.js:5-24`) no tiene campo de escala; `imageScale`/`image_scale` tienen **cero** coincidencias en todo el repo (ni renderer, ni main, ni Python). El usuario mueve el slider y el resultado es idéntico. O falta el resto de la feature (campo `imageScale` en la op → `image_scale` en payload → soporte en `processor.py`), o sobra el control. Es el único caso donde el "estado almacenado" no conecta con nada.

### 2. Contrato IPC roto disfrazado: "busy" se detecta parseando prosa en español (defecto latente)

`isAlreadyRunningFailure` (`src/utils/batch-runner.js:4-9`) decide si el fallo de `startProcessing` es "ya hay un proceso" así:

```js
if (result.code === "already_processing") return true;
return typeof err === "string" && /proceso en ejecución/i.test(err);
```

pero `main/handlers/process.js:154` devuelve `{ success: false, error: "Ya hay un proceso en ejecución" }` **sin `code`**. La rama estructurada es código muerto; todo depende de un regex sobre texto localizado generado en otro proceso. Renombrar el mensaje en main (o traducirlo) rompe silenciosamente la ruta `keepProcessing` de `runBatch` (`batch-runner.js:24`) → el renderer resetea `isProcessing=false` mientras un run sigue activo → doble arranque real posible. Remediación: emitir `code: "already_processing"` (o un `busy: true`) en `process.js:154` y borrar el regex. Mismo patrón con el centinela `item.error === "Cancelled"` en `abortProcessingQueue` (`export-pipeline.js:233`), aunque ahí está marcado como legacy.

### 3. Fuga i18n sistémica: catálogos y stores producen strings en español que se pintan crudos (alto)

Las claves i18n están sanas (594/594 con paridad exacta; `theme.preset.*` cubre los 44 presets sin huérfanos — verificado por script). El problema es que **el dominio trae texto de UI embebido en español** y los componentes lo pintan tal cual:

- `DELOGO_METHODS[].label/.description` (`types.js:114-154`) → `PropertiesPanel.jsx:460` (`{m.label}`), `:467` (description) y `AppliedDelogoEditor.jsx:148,172`; `MIRROR_SIDES[].label` (`types.js:156-161`) → `PropertiesPanel.jsx:535`, `AppliedDelogoEditor.jsx:241`. En UI en inglés se ven "Desenfoque", "← Reflejar desde derecha", etc.
- `TRUNCATE_MODES[].label/.title` (`text-layout.js:7-11`) → `TextLayoutControls.jsx:121-123` ("Ninguno", "Puntos suspensivos").
- `TEXT_STYLE_PRESETS[].name` (`types.js:163-868`, 32 presets) → `StyleEditor.jsx:84,110` ("Sin estilo", "Bloque ámbar"…). `theme/presets.js` resolvió exactamente esto con `nameKey` — los text presets deberían usar el mismo patrón.
- `FONT_WEIGHTS[].label` (`types.js:98-106`) en inglés fijo ("Thin", "Regular") → `StyleEditor.jsx:156-157`, `TableEditorFocusPanel.jsx:182`.
- Strings de negocio hardcodeados en slices que se muestran en UI: `"Texto de ejemplo"` (`batchSlice.js:78,87`, y otra copia en `VideoPreview.jsx:1305,1339`); el mensaje de importExcel (`batchSlice.js:332-333`, `"Vinculados X/Y videos correctamente…"`) — `importExcelFromDialog` (`import-excel.js:43`) prefiere `result.message` sobre `t("batch.excelLinked")`, así que la clave existente queda sin usar; errores en inglés dentro de una app ES-first en `exportExcel` (`batchSlice.js:239,243,274`); errores en español en `projectSlice.js:35,116,162,195,202` y `processingSlice.js:239,244,246` / `export-run.js:61,65`.
- Enum localizado como valor de máquina: `petMovement: "fijo"|"caminar"` persiste en settings (`petSlice.js:46,116`), se duplica como default en main (`main/utils/settings.js:48`), viaja por IPC en `buildPetOverlayPayload` y se compara en `PetSurface.jsx:99`. Funciona, pero es un enum que depende del idioma atravesando 3 fronteras. Convención: el patrón correcto ya existe en el repo — `authError` usa claves tipo `"auth.invalidCredentials"` y los componentes las traducen (`authSlice.js:129,148`); aplicarlo a estos errores.

### 4. `uiSlice` es el god-slice: 5 dominios en 410 líneas (estructura)

`uiSlice.js` mezcla: gestión de tema completa — slots, `customThemes` CRUD, migración (`migrateThemeSettings`), `deriveWindowChrome`, persistencia — (`:37-260`), idioma, recents (`:275-332`), máquina de estados del updater (`:334-398`), flags de modales (`:56-62,400-408`), toasts y `confirmDialog` con `resolve()` guardado en estado (`:67-93`). Las otras slices son cohesivas; esta acumuló todo lo que no tenía hogar. Nota agravante: `batchSlice` tiene sus propios flags de modal (`showMappingModal`, `showTableEditor`, `batchSlice.js:56-57`) — los modales viven en dos slices sin criterio. Remediación: `themeSlice` (themeSlot\*/customThemes/todo lo que llama a `theme/engine.js`), `updaterSlice` (`update` + `applyUpdaterEvent`/`checkForUpdates`/`downloadUpdate`/`installUpdate`), `settingsSlice` (language + loadSettings + recents), y uiSlice queda en ~60 líneas de modales/toast/confirm. El caso base para dividir existe: `loadSettings` (`:110-160`) ya orquesta hydration de settings de otros slices — es natural que la hidratación viva con los campos que hidrata.

### 5. Defaults del dominio duplicados en 2–3 sitios (single-source perdido)

- **Delogo**: `blurStrength:20` en `editorStyleSlice.js:13`, `operation.js:10` y `DELOGO_FIELD_BOUNDS.blurStrength.default` (`delogo-ops.js:12`). Igual para `temporalRadius:3`/`mosaicSize:12`/`edgeFeather:6` (×3 cada uno) y los literales `delogoMethod:"blur"`, `mirrorSide:"right"`, `delogoFillColor:"black"`, `delogoFillOpacity:1` (createOperation + editorStyleSlice + fallbacks inline de `sanitizeDefaults`, `sanitize-preset.js:76-107`). Un `DELOGO_DEFAULTS` derivado de `DELOGO_FIELD_BOUNDS[*].default` + constantes de método en `delogo-ops.js` los unifica; `createOperation` y el estado inicial del slice hacen spread de él.
- **Watermark**: `watermarkSlice.js:3-15` (init), `persistWatermark` fallbacks (`sanitize-preset.js:53-67`) y los defaults de Python (`processor.py:1491-1545`) — el enum de 9 posiciones vive en `watermark-position.js` y paralelo en `pos_map` de Python (`processor.py:1496-1510`). JS↔Python puede quedar como contrato compartido en `shared/` (JS) con comentario de paridad en Python, igual que `isOpActive`/`op-active-fixtures.json`.
- **`update` inicial** de `uiSlice.js:45-54` es una copia literal de `IDLE_UPDATE` (`updateState.js:1-10`) — `update: { ...IDLE_UPDATE }`.
- **`idAliases`**: `batchSlice.js:294-304` y `rowGet` (`video-utils.js:231-241`) tienen el mismo set de 9 alias en orden distinto y semántica divergente (importExcel toma `headers[0]` como fallback; rowGet hace alias-fallback por valor). Una lista exportada `ID_COLUMN_ALIASES` elimina la divergencia.
- **`fmtTime`** (`video-utils.js:193-199`) vs **`formatFooterClock`** (`appVersion.js:61-68`): dos formateadores h:mm:ss con padding distinto ("5:03" vs "05:03").
- **`1920×1080` fallback**: `queueSlice.js:429-430` y `PRESET_REGION_FALLBACK_*` (`sanitize-preset.js:9-10`).
- **build id→rowIdx**: implementado 3 veces en `batchSlice` — `_buildExcelRowIndex` (`:352-367`), `syncAllOperationsToExcel` (`:410-416`), `_reapplyExcel` (`:488-496`). Los dos últimos podrían consumir `excelRowIndexByFilename` + un `Set` de duplicados que `_buildExcelRowIndex` ya podría producir (`{index, duplicates}`).

### 6. Estado derivado almacenado (y persistido) con bookkeeping manual

- `excelMatchStatus` es función pura de `(queue, excelRows, excelMapping, templateRegions)`; se almacena (`batchSlice.js:53,484,561`), se **persiste** en sessionStorage (`session-persist.js:53`) y `removeVideo` lo remapea a mano con desplazamiento de claves índice (`queueSlice.js:340-345`). Alternativa: selector memoizado o recalcular en el mismo set() que ya muta queue.
- `excelRowIndexByFilename` + `_excelRowIndexSource`: índice derivado almacenado, persistido (`session-persist.js:54`) y restaurado con un marcador de identidad por referencia (`session-persist.js:93-95`, `batchSlice.js:377`). Judo: no persistir el índice; tras aplicar `_restoredSession` llamar una vez a `_buildExcelRowIndex()` en `useEditorStore.js` — se elimina un campo del esquema persistido. (`_excelRowIndexSource` sigue siendo necesario para el fast-path de syncTextToExcel, es legítimo.)
- `progressDone`/`progressTotal` conviven con el estado terminal de `queue[i]` y con `jobProgress`; `getBatchProgress` (`batch-progress.js:9-10`) reconcilia con `Math.max` — defensivo pero revela que nadie es la fuente única.
- Doble representación de progreso: `queue[i].progress` vs `jobProgress[idx]`, controlada por `PERF_FLAGS.progressMap` con default `true` (`perf-flags.js:22`). Como ningún `.env`/script lo apaga, la rama `applyJobProgressMessages` que escribe progress en items (`export-pipeline.js:42-67`) es camino muerto en producción — o se asume y se borra, o se documenta como escape hatch.

### 7. Actualizaciones no atómicas: acciones de usuario = 2–3 `set()` observables

- `updateTemplateRegion` (`batchSlice.js:134-164`): un `set()` para región+queue y luego `patchBatchTextStyle` hace un segundo `set()` (`:200-204`). Un drag que mueve una región con estilo produce dos commits/suscripciones.
- `setShowTableEditor(false)` (`batchSlice.js:603-609`): `materializeBatchTextOps` (set) → `syncAllOperationsToExcel` (set) → `set(showTableEditor)` — 3 commits por cerrar el editor.
- `deleteCustomTheme` (`uiSlice.js:223-244`): hasta 3 `set()` secuenciales (slot1, slot2, customThemes).
- `applyToAll` (`batchSlice.js:207-233`): set queue → `_reapplyExcel` (set).
- `loadInstalledPets` (`petSlice.js:228-234`): set installed + set de corrección de slug.
  No hay bugs observables hoy (React batea renders del mismo tick), pero el patrón "secuencia de sets por acción" hace que los suscriptores (incluido el persist-debounce y los tests) observen estados intermedios, y es exactamente lo que `updateJobProgressBatch`/`createBatchStartPatch` evitan con cuidado en el camino caliente. Pauta: componer el patch completo y un solo `set`.

### 8. `types.js` es un vertedero — y `TEXT_STYLE_PRESETS` puede colapsar 4× (code-judo principal)

897 líneas mezclan: math de regiones (`normalizeRegion`/`denormalizeRegion`/`ensureNormalized`/`isNormalizedRegion`, `:4-71`), `uid` (`:73-77`), catálogos UI (`FONT_FAMILIES`, `FONT_WEIGHTS`, `TEXT_ALIGNS`, `DELOGO_METHODS`, `MIRROR_SIDES`, `:79-161`), `TEXT_STYLE_PRESETS` (`:163-868` — **~700 líneas, 78% del archivo**) y la factoría `createQueueItem` (`:870-897`). Para un archivo llamado "types" con `// @ts-check` no hay un solo `@typedef` de `QueueItem`/`Operation`/`Region` — el modelo de dominio queda implícito en los defaults de las factorías.

El judo medido: los 32 presets tienen **exactamente las mismas 20 claves** (verificado por script: 17 campos de estilo + id/name/previewBg; ninguno usa `textAlign`/`autoFit`/`lineHeight`/`verticalAlign`/`textWrap`/`safeMargin`/`truncate`). Cada entrada repite los 17 campos aunque la mayoría coinciden con el baseline. Un helper `mkTextPreset(id, name, previewBg, overrides)` sobre un objeto base congelado produce datos **idénticos** (los overrides son los valores ya escritos) y convierte cada preset en 5-9 líneas declarativas — de ~700 a ~200 líneas, y hace legible qué cambia cada preset respecto al base. La misma idea sirve a escala menor para `theme/presets.js` (44×15 tokens), aunque ahí las paletas son genuinamente distintas y el `t()` ya garantiza completitud; su único defecto es que una clave errónea produce `undefined` silencioso (`presets.js:5-11`) que solo se detectaría con `validateThemeTokens` — un assert de completitud en init (o en test, ya existe `theme-engine.test.js`) cierra el hueco.

División sugerida: `types.js` → `region.js` (math) + `domain/catalogs.js` (FONT\_\*, DELOGO_METHODS, MIRROR_SIDES) + `domain/text-style-presets.js` (data) + `queue-item.js`. Bonus: así `delogo-ops.js` deja de importar el catálogo UI (`MIRROR_SIDES`) para derivar validación (`delogo-ops.js:2,6`).

### 9. `authSlice` repite 3 veces fetchProfile→gate→set (code-judo seguro)

`applySession` (`authSlice.js:25-57`), `initAuth` (`:93-133`) y `signIn` (`:153-176`) implementan la misma secuencia con matices de retorno. Extraer `applySession` como único camino y devolver un `reason` derivado del estado (`get().authError`) elimina ~40 líneas duplicadas y unifica el manejo de `signOut` tras gate en 3 sitios. (Detalle: `signIn` además registra el listener tarde — `ensureAuthListener` al final `:168` — y el evento `SIGNED_IN` dispara `applySession` con un segundo `fetchProfile` redundante; aceptable pero digno de comentario.)

### 10. Duplicación de plumbing: persistir settings, gestos raf-batched, y "private API" inconsistente

- `persistPetSettings` (`petSlice.js:27-35`), `persistThemeSettings` (`uiSlice.js:27-35`), `persistProcessingSetting` (`processingSlice.js:18-26`) y una 4ª copia inline en `setLanguage` (`uiSlice.js:265-272`): mismo `api.saveSettings` + try/swallow. Un `persistSettings(partial, label)` en `utils/` y cada slice lo llama — 4 sitios → 1.
- `syncPetOverlay("idle")` como cola repetida en 5 setters de pet (`petSlice.js:100-104,110-113,119-122,171-173,207-209`): un `patchPet(partial, {sync:true})` colapsa el patrón "set → persist → sync overlay".
- `useCanvas` (mousemove + `pendingMoveRef` + raf, `useCanvas.js:157-186`) y `useRegionGesture` (pointermove + raf, `useRegionGesture.js:26-63`) duplican el andamiaje de sesión de gesto; la geometría ya está compartida en `region-interaction.js`. Un `usePointerSession`/`useGestureRaf` extraíble. Además coexisten dos stacks de eventos (mouse vs pointer) sin razón aparente.
- Singletons de módulo en factories de slice: `outputPathsCache` (`queueSlice.js:43`), `petsInitPromise` (`petSlice.js:10`), `_authListenerRegistered` (`authSlice.js:3`). Con una sola store real no hay bug, pero una segunda instancia (tests) comparte el caché/listener — `authSlice` es el peor: el listener queda ligado al `set` de la **primera** store creada.
- `useKeyboard.js`: la lista de modales "abierto encima" se escribe dos veces (cascada Escape `:20-53` y guardia `:69-80`); `TOOL_KEYS` (`:5-11`) duplica el orden de `EDITOR_TOOLS` (`editor-tools.js`) — reordenar uno remapea los atajos 1-5 silenciosamente. Derivable: `Object.fromEntries(EDITOR_TOOLS.filter(t=>t.id!=='pan').map((t,i)=>[i+1,t.id]))`.
- `catch {}` desnudo vs `swallow()`: el helper existe y se usa en ~15 sitios, pero `session-persist.js:145`, `queueSlice.js:372`, `useUpdater.js:34,49` y varios de `petSlice`/`uiSlice` tragan sin etiqueta. `safeStorage` solo envuelve localStorage; `session-persist.js` reimplementa try/catch para sessionStorage (`:99-116,124-146`).
- `appVersion.js` es un nombre que miente: contiene el parser de release notes y el reloj del footer.
- `useCloseOnOutsideClick` también cierra con Escape — el nombre subestima el contrato.

### 11. Regiones sin etiqueta de unidades + servicios dentro del estado (notas de diseño)

- `ensureNormalized` (`types.js:53-71`) adivina si una región viene en px o normalizada por rango; una región `{x:0,y:0,w:1,h:1}` en px = video completo normalizado. Funciona porque el canvas produce coordenadas normalizadas desde el gesto, pero el tipo `Region` no lleva unidades — es la clase de invariante que `@ts-check` + typedef `{x,y,w,h}`-normalized podría fijar.
- La queue slice aloja servicios de lectura derivada (`selected`, `videoBounds`, `outputPathFor`, `outputPathsForAll` con caché de módulo `outputPathsCache`) — correctos y cacheados, pero son funciones en el estado, no datos: los consumidores deben suscribirse a los campos subyacentes. Documentar el patrón o moverlos a selectores en `utils/`.
- `useEditorStore.js` restaura `_restoredSession` con spread sobre los defaults (`:50`) — las claves restauradas están whitelisted por `parseSessionSnapshot`, bien; pero `excelRowIndexByFilename` restaurada obliga al marcador `_excelRowIndexSource` (ver hallazgo 6).
- `processingHooks` (`processingSlice.js:28-38`) recrea el objeto por llamada — inocuo.
- `processAll`/`processSingle` mezclan snapshots (`queueForProcessing` se toma antes del check de `isProcessing`, `:202-209`) — TOCTOU benigno, y los guards de materialize difieren (`sidebarMode==="batch" || regions` vs solo `regions`, `:198` vs `:240`) sin razón.
- `PERF_FLAGS` en `perf-flags.js` lee `import.meta.env` defensivamente — bien.

### Lo que está bien (para no perderlo en el refactor)

- `shared/job-manifest.js` es el mejor módulo del alcance: sobre {type,version} explícito, `normalizeJob` centraliza defaults en todos los seams (renderer `createJobManifest`, main `unwrapJobManifest`/`createProcessorManifest`), con invariantes documentados (`video_info_probed`, id entero por posición). El hueco: `operations` pasa sin validación por-op y `watermark` es opaco (`isPlainObject → keep`, `job-manifest.js:48-49`) — el esquema es "defaults para claves conocidas", no validación estructural.
- `shared/ipc-channels.js` tabla única + `RUN_SCOPED_CHANNELS` + `emitRunEvent`. La duplicación en `preload.cjs` (~62 literales CJS) está forzada por el sandbox y **cubierta por test** (`tests/preload-subscriptions.test.js`) — aceptable; alternativa: generar el preload o compartir un `.cjs` espejo.
- `export-pipeline.js`/`export-run.js`: reducers puros que devuelven patches — testables, atómicos (un `set` por evento), buen diseño.
- `session-persist.js`: `SESSION_PERSIST_FIELDS` como fuente única de save/restore/watch — patrón ejemplar.
- `delogo-render-*`: core puro + worker + bridge con orden de resultados y staleness — bien factorizado.
- `updateState.js`: máquina de estados del updater como reducer puro.
- `batch-capacity.js` `capacityJobsSignature`: firma primitiva para selectores — derivación hecha bien.
- i18n `useT`/`lookupMessage`: dict→fallback→key, y paridad es/en garantizada por `tests/i18n-parity.test.js`.

## Propuestas de remediación (orden de retorno)

1. **Borrar/decidir `tempImageScale`** — si la feature no existe en el pipeline, quitar campo+setter+slider; si existe, cablear `imageScale` a la op y al payload Python. (Evidencia: hallazgo 1.)
2. **`code` estructurado para "busy"** en `process.js:154` + borrar el regex localizado de `batch-runner.js`. 15 minutos, elimina un defecto latente.
3. **`mkTextPreset` base+overrides** en `TEXT_STYLE_PRESETS` (~700→~200 líneas, output idéntico verificado) + sacar datos de `types.js` a `domain/`.
4. **`nameKey` para catálogos UI** (DELOGO_METHODS/MIRROR_SIDES/TRUNCATE_MODES/TEXT_STYLE_PRESETS/FONT_WEIGHTS) — replica el patrón `theme.preset.*` ya probado; y en stores, devolver códigos i18n (`auth.error`-style) en vez de prosa ES/EN mezclada.
5. **`DELOGO_DEFAULTS`/`WATERMARK_DEFAULTS`/`ID_COLUMN_ALIASES`/`IDLE_UPDATE` reuse** — borra las 4 familias de literales duplicados.
6. **Dividir `uiSlice`** en theme/updater/settings/modales (es el único slice multi-dominio).
7. **Un `persistSettings` compartido + `patchPet` con sync** — borra 4+5 copias del mismo plumbing.
8. **`_buildExcelRowIndex` único** consumido por `syncAllOperationsToExcel`/`_reapplyExcel`, y dejar de persistir `excelRowIndexByFilename`/`excelMatchStatus` (rebuild en restore) — elimina estado derivado persistido.
9. **Un solo `set()` por acción de usuario** en `updateTemplateRegion`, `setShowTableEditor`, `deleteCustomTheme`, `loadInstalledPets`.
10. **`applySession` unificado** en authSlice.
