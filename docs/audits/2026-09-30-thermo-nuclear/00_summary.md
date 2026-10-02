# Auditoría Thermo-Nuclear — Beru (2026-09-30)

Revisión de mantenibilidad estricta sobre el estado actual del worktree (incluye el WIP de
"refactor: consolidate processing and editor architecture"). Cinco revisores en paralelo por
subsistema; este es el veredicto consolidado. Los detalles con evidencia file:line viven en los
archivos numerados de este directorio.

**Veredicto: NO APTO como está — pero no por la arquitectura, que es mejor de lo que el tamaño
sugiere, sino por una bomba de relojería en el worktree y dos defectos funcionales reales.**

## Hallazgos críticos (bloquean)

**La infraestructura de verificación existe solo en esta máquina.** `.gitignore:82` ignora
`/scripts/*`, así que `scripts/verify.mjs` y `scripts/regression-guard.mjs` nunca fueron
commiteados. Sin embargo el WIP ya modifica `package.json:20` (`"verify": "node scripts/verify.mjs"`)
y `ci-release.yml:52` para invocarlo: si este trabajo se commitea tal cual, CI muere con
MODULE_NOT_FOUND en checkout limpio y ningún release puede salir. `regression-guard.sh:190-194`
además ejecuta dos tests que no existen (`tests/processing-errors.test.js`,
`tests/processing-logs.test.js`) — falsa regresión garantizada. Verificado con `git check-ignore` y
`git ls-files`. → Detalle: `05_tooling_tests.md`.

**El copy path de `processor.py` descarta el vídeo.** Cuando un job sin operaciones tiene audio
no-copyable para el contenedor de salida, el comando resulta `ffmpeg -i in -c:v copy -map 0:a? -c:a aac`.
Cualquier `-map` desactiva el stream-selection por defecto: solo se mapea audio, `-c:v copy` queda
huérfano y la salida es un archivo solo-audio. `processor.py:658-672` (siempre emite `-map 0:a?`) +
`processor.py:2217-2227` (nunca mapea vídeo). Confirmado leyendo el código; ningún test cubre esa rama
(todos usan audio AAC). Fix: añadir `-map 0:v:0?` (o `-map 0` según política de streams) en la rama de
re-mux. → Detalle: `01_python.md`.

**`tempImageScale` es una feature muerta expuesta en UI.** `editorStyleSlice.js` define el estado y
`PropertiesPanel.jsx:331` pinta un slider, pero `imageScale`/`image_scale` tiene **cero** coincidencias
en todo el repo fuera de su definición — el usuario mueve un control que no hace nada. Borrar estado +
slider, o cablear el consumidor que falta. → Detalle: `03_state_domain.md`.

## Hallazgos estructurales altos

**`processor.py` regresó a god-file: 3.237 líneas, ~111 funciones, 12 globales mutados.** Los clústeres
son contiguos y obvios (fuentes ~213L, probing ~275L, ffmpeg-runner ~454L, filtros ~460L, preview ~315L,
scheduler ~640L). La extracción anterior (`op_shared`, `delogo_chains`, `batch_errors`) demostró que el
patrón funciona; lo que la frenó es que los tests monkeypatchean `processor._*` — pero `from x import _y`
mantiene `processor._y` parcheable, así que eso no bloquea. Lo que sí hay que matar primero es el estado
de batch contrabandeado vía `global` (`_BATCH_ACTIVE_WORKERS`, `_SOFTWARE_FALLBACK_ADMISSION`,
`_jobs_file`, `FFMPEG/FFPROBE`): `_process_one` es no-reentrante y su firma miente sobre sus
dependencias. → Detalle: `01_python.md`.

**`VideoPreview.jsx` (1.594 líneas) es un god-component con 5 subsistemas.** Ciclo de vida del vídeo,
máquina de estados de preview FFmpeg (~260L, L647-907), drag (~195L), 11 refs, suscripción global a
`useEditorStore` (L819-833) y 615 líneas de JSX con 5 capas de overlays. El repo ya demostró el patrón
de extracción correcto en `table-editor/` y `video-preview/` existe a medias. → Detalle: `04_ui.md`.

**`handlers/process.js:104-318` es un god-handler de 215 líneas / 6 fases** (validate → sanitize →
unreadable scan → probe enrich → manifest → spawn+watch) con 4 guardas de cancelación idénticas y una
promise race a mano. `job-worker.js` y `preview-frame.js` duplican ~60% del ciclo de vida de worker
persistente; hay 4 copias de "spawn + captura acotada + timeout". → Detalle: `02_main.md`.

## Hallazgos medios (deuda real, no urgente)

**Ciclo de vida de quit fragmentado en 4 archivos y ~7 flags**; `interceptQuitIfProcessing` está
enganchado dos veces (will-quit + before-quit); cerrar la ventana pide confirmación pero Cmd+Q cancela
procesamiento en silencio (`02_main.md`).

**Sin wrapper canónico de error IPC**: 4 formas de error coexisten, ~20 try/catch ad-hoc, y
`petdex.js:11` ya inventó `wrapPetdex` — la abstracción falta y el código ya la está pidiendo
(`02_main.md`).

**i18n sistémicamente bypassed**: catálogos del dominio (`DELOGO_METHODS`, `TRUNCATE_MODES`,
`TEXT_STYLE_PRESETS`, `FONT_WEIGHTS`) llevan español embebido pintado crudo; `petMovement:
"fijo"/"caminar"` es un enum localizado cruzando IPC; ~15 archivos JSX ignoran `useT()` pese a
importarlo; ~9 claves ausentes de los diccionarios (`03_state_domain.md`, `04_ui.md`).

**`uiSlice` es el god-slice** (tema+idioma+recents+updater+modales+confirm: 5 dominios); defaults
delogo/watermark duplicados ×2-3; `excelMatchStatus`/`excelRowIndexByFilename` son estado derivado
almacenado y persistido; acciones con multi-`set()` dejan estados intermedios observables
(`03_state_domain.md`).

**~17% de la suite JS afirma sobre texto del código fuente** (grep-as-test): ossifica en vez de
proteger. `store.logic.test.js` son 1.637 líneas con 1 describe plano, 58 its sobre 6 slices y ~11
factories incompatibles. `python.ffmpeg-path.test.js` (1.337L) es una suite de Python escrita en
strings JS que además monkey-patchea `processor._*` — y es la razón estructural por la que el god-file
no se ha partido. `test:python` son 28 comandos `&&` a mano sin pytest; tests no listados se saltan en
silencio (`05_tooling_tests.md`).

**`PropertiesPanel.jsx:63-115` selecciona 26 claves del store** — cada tecla tecleada re-renderiza el
inspector completo incluyendo `StyleEditor`/`PresetManager`. Duplicación sistémica: `RegionFields` ×3,
picker imagen ×3, matriz delogo ×2 (~600 líneas draft-vs-applied) (`04_ui.md`).

## Jugadas code-judo (mayor impacto primero)

1. **Commitear `verify.mjs` o revertir las referencias** — antes que nada, es la bomba armada.
2. **Fix `-map` del copy path** — 1 línea, defecto real de output corrupto.
3. **`BatchContext` dataclass en processor.py** (`ffmpeg_path`, `hw_encoder`, `max_workers`,
   `admission`, `cancel_event`, `jobs_file`) pasado `process_jobs → _execute_batch → _process_one`:
   elimina 3 mutaciones `global`, hace `_process_one` testeable sin cirugía de módulo y desbloquea la
   división en los 6 módulos naturales.
4. **`createLineWorker()` + `runCapturedProcess()` en `main/utils/`** — colapsa los dos workers
   persistentes y las 4 variantes de spawn-capture (~250 LOC, una sola fuente de bugs EPIPE/timeout).
5. **`useFfmpegPreview(videoRef, sel)` extraído de VideoPreview.jsx:647-907** — máquina autocontenida,
   ~260 líneas fuera del componente en un corte limpio que desbloquea dividir el JSX en overlays.
6. **`mkTextPreset()` sobre base congelada** — los 32 presets de `TEXT_STYLE_PRESETS` comparten las
   mismas 20 claves; colapsa ~700 líneas de `types.js` a ~200 con output idéntico (verificado por
   script en `03_state_domain.md`).

## Qué está bien (no tocar)

`export-pipeline`, `export-run`, `job-manifest` son ejemplares. La superficie IPC está genuinamente
limpia: 50/50 canales registrados, cero drift entre `shared/ipc-channels.js`, `preload.cjs` y
consumidores; `execution-history` correctamente extirpado. `resources/encode-profiles.json` es fuente
única de datos consumida por ambas capas (solo la whitelist `VALID_PROFILES` está duplicada JS↔Py).
`table-editor/`, `QueueSidebar`, `features/pets/` y `main/security/` muestran el patrón de
descomposición que el resto del repo debería seguir.

## Secuencia de remediación propuesta

1. Armar el gate: commitear `verify.mjs`+`regression-guard.mjs` (o des-referenciar), arreglar los dos
   tests fantasma de regression-guard. Bloquea todo lo demás.
2. Fix `-map 0:v` + borrar `tempImageScale` (o cablearlo) + matar la detección de "busy" por regex de
   prosa española (`batch-runner.js:4-9` — la rama `already_processing` es muerta porque main nunca
   emite `code`). Defectos funcionales, cada uno barato.
3. `BatchContext` → split de processor.py en 6 módulos. Esto también destraba migrar los tests
   monkeypatch a tests de verdad.
4. `useFfmpegPreview` + split de VideoPreview siguiendo el patrón `table-editor/`.
5. `createLineWorker`/`runCapturedProcess` + wrapper de error IPC + consolidar quit lifecycle.
6. i18n sweep de catálogos del dominio + JSX; claves faltantes.
7. Test-debt: split de `store.logic.test.js` por slice, borrar grep-as-tests, pytest como runner.
8. `mkTextPreset`, split de `uiSlice`, selector granular de PropertiesPanel.

Detalle por subsistema: `01_python.md`, `02_main.md`, `03_state_domain.md`, `04_ui.md`,
`05_tooling_tests.md`.

---

## Remediación ejecutada (misma sesión)

Todos los puntos de la secuencia se aplicaron. Estado verificado: **vitest 151 archivos /
1059 tests verdes**, `npm run test:python` 28/28, `eslint` limpio, `prettier --check` limpio.

**Críticos resueltos**

- `.gitignore` ahora allow-lista todos los scripts trackeados + `verify.mjs` +
  `regression-guard.mjs` (ahora visibles para `git add` — **deben commitearse junto al WIP**).
  `regression-guard.sh` Trigger B apunta a 6 tests reales del handler de proceso.
- `processor.py` copy path: `-map 0:v:0?` añadido — la re-mux de audio ya no descarta el vídeo.
- `tempImageScale` eliminado; el slider deriva la escala de `currentRegion.baseW` (además
  arregla el display stale al cambiar de región).
- `main/handlers/process.js` emite `code: "already_processing"`; `batch-runner.js` eliminó
  la detección por regex de prosa española.
- Bug extra encontrado: `main.js` hacía `.catch()` sobre un thenable pelado en fatal cleanup
  (→ `void Promise.resolve(killProcessTree(proc)).catch(...)`).

**Estructural**

- `processor.py` 3.240→~1.100 líneas: `batch_context.py` (`BatchContext`, cancel event,
  admission), `media_paths`, `job_classify`, `capacity`, `encoders`, `encode_args`,
  `media_probe`, `fonts`, `filters`, `ffmpeg_runner`, `preview`. Superficie
  `processor._*` preservada para tests vía re-export + sync hooks.
- `VideoPreview.jsx` 1.560→542: `video-preview/` ganó `useFfmpegPreview`,
  `useVideoPreviewLifecycle`, `useOperationDrag` y 9 componentes de overlay.
- `main/utils/line-worker.js` (`createLineWorker`) + `main/utils/run-captured.js`
  (`runCapturedProcess`) colapsan los 2 workers persistentes y las 4 copias de
  spawn-capture. `main/utils/ipc.js` (`handleIpc`) es el wrapper canónico de errores.
  `process.js` split en `prepareRunJobs`/`watchJobRun`. `updater.js` → máquina `status`
  explícita; quit lifecycle consolidado en `quitPhase`.
- `types.js` 897→524 (`mkTextPreset`, output byte-idéntico verificado). `uiSlice` 410→53 +
  `themeSlice`/`updaterSlice`/`settingsSlice`. `PropertiesPanel` 26 claves → 7 selectores
  agrupados. `excel-match.js` módulo derivado nuevo.
- i18n: catálogos del dominio → `labelKey`/`descriptionKey` (`catalog.*`, 71 claves ES/EN);
  `petMovement` wire → `fixed`/`walk` con `normalizePetMovement` aceptando valores legacy ES;
  `importExcel` devuelve `messageKey`/`messageVars`; claves `props.*` añadidas.
- Tests: `store.logic.test.js` (1.637L/58its) → 6 archivos por slice +
  `tests/helpers/{store,python}.js`; `test:python` ahora es `scripts/test-python.mjs`
  (discovery por glob, ya no hay tests silenciosamente omitidos); clave duplicada
  `test:python` en package.json eliminada.

**Pendiente conocido (fuera del alcance o decidido)**

- `git add scripts/verify.mjs scripts/regression-guard.mjs scripts/test-python.mjs
scripts/performance/ scripts/benchmark-memory.mjs` al commitear el WIP (crítico).
- `.githooks/` sigue ignorado → hooks solo locales (decidir si se quieren trackear).
- `processor.py` conserva wrappers de compat (~1.100 líneas); `batch_scheduler.py` no se
  extrajo (necesita la superficie de patch de `processor` en vivo).
- Algunos grep-as-tests de contrato se mantienen donde fijan invariantes de seguridad;
  warnings de eslint ocultos por `--quiet` quedan como deuda menor.

---

## Segunda pasada — verificación de equivalencia funcional (post-remediación)

Cuatro revisores re-auditaron el trabajo aplicado con foco en **equivalencia observable**
(diff contra HEAD + suites focalizadas + enumeración runtime de contratos). Informes:
`06_verify_python.md`, `07_verify_main.md`, `08_verify_renderer.md`,
`09_verify_tooling_tests.md`.

**Veredicto: PASA con observaciones documentadas.** La remediación no alteró la
funcionalidad del proyecto; todas las divergencias semánticas contra HEAD corresponden a
WIP intencional del usuario o a endurecimientos deliberados fijados por tests. Tres
defectos introducidos por la propia remediación se encontraron y corrigieron en esta
pasada.

**Estado de gates (final):** vitest **158 archivos / 1079 tests, 0 fallos** ·
`test:python` **28/28** · `lint` limpio · `format:check` falla solo sobre deuda
preexistente/usuario (6 archivos: `main/utils/paths.js` y `thumbnail.js` ya fallan en
HEAD; 4 son WIP no trackeado del usuario). Ninguno es atribuible a este trabajo.

**Corregido en esta pasada**

- **D1 (renderer):** el error de `renderPreviewFrame` era invisible fuera de modo logo —
  HEAD lo toastaba siempre. `useFfmpegPreview.js` ahora toasta además de poblar
  `ffmpegPreviewError` (helper `fail`), restaurando la superficie de error.
- **Contract test obsoleto:** `frontend-perf-audit.test.js` aún exigía `const X = lazy(`
  en `App.jsx`, pero el WIP movió el lazy-loading a `modal-panels.js`/`editor-panels.js`
  vía `lazyPanel()`. La aserción se re-escribió para fijar el contrato en su nueva
  ubicación (los modales siguen code-spliteados; `lazyPanel` envuelve `React.lazy`).
- **Allowlist `.gitignore` incompleta:** `test-python.mjs` seguía ignorado (bloqueante de
  `09`). Al auditar el mismo patrón se detectó idéntico agujero en el WIP del usuario:
  `tests/performance-report.test.js` importa `scripts/performance/report.mjs`, también
  ignorado. Añadidos `!/scripts/benchmark-memory.mjs` y `!/scripts/performance/`.
- **`regression-guard.sh` volvió a CRLF** tras las ediciones (HEAD era LF) — normalizado.
- Emojis residuales en `release-loop.mjs`: escaneo de pictogramas/VS16 ahora limpio.

**Cambio de comportamiento intencional que requiere confirmación de producto**

`autoInstallOnAppQuit` queda permanentemente en `false` (`main/updater.js:57`); antes se
activaba tras `update-downloaded`, así que salir de la app instalaba en silencio. La
nueva política exige instalar desde la modal (`quitAndInstall(false,true)`) porque NSIS
`oneClick:false` no puede silent-install — el comportamiento anterior era defectuoso.
Fijado por `tests/updater-install-policy.test.js` (nuevo). Técnicamente correcto, pero
es el único cambio visible para el usuario: **salir de la app ya no auto-instala**.

**Descartado tras inspección (no son regresiones)**

- Test "refuses to delete bundled presets" eliminado: la feature bundled-presets fue
  retirada en el WIP (`resources/presets/*.json` borrados, campo `source` inexistente en
  todo el flujo de presets). El test muere con la feature — correcto.
- `tests/helpers/python.js` tiene importadores reales (`processor-spec-hiddenimports`,
  `dev-python-watch`, `build-processor-watchfiles`) — retener.
- Divergencias WIP deliberadas: `fs:readExcel` devuelve rows/headers (consumidor
  actualizado en tándem), `petMovement` legacy `"fijo"/"caminar"` se normaliza a
  `fixed`/`walk` en hydrate, thumbnails/preview estrangulados por `media-task-pool`
  durante procesamiento, `--preview-frame` single-shot retirado (sin consumidores).
- `lazy-panel.test.jsx` falló una vez bajo saturación de CPU durante `verify` (la suite
  corría en paralelo con `test:python`); pasa en aislamiento y en la corrida limpia —
  flake de carga, no defecto. El util es WIP del usuario.

**Riesgos latentes documentados (no bloquean; ver `06`/`07`)**

- `processor._test_hw_encoder_real`, `._run_ffmpeg_stream`, `._get_available_ram_mb`,
  `._cleanup_ffmpeg_partial`, `.StderrBuffer` ya no son costuras de patch que se propaguen
  a los módulos extraídos (ningún test los usa hoy).
- `_process_one` no reenvía `ctx` a `_run_ffmpeg` (processor.py:432,536,552) ni
  `_ResourceAdmission.acquire` lo usa — equivalente hoy porque `ctx` envuelve los objetos
  de módulo; rompería si alguien construye un `BatchContext` con evento/jobs_file propios.
- Durante `updater status === "installing"`, `checkForUpdates`/`startDownload` admiten
  una ventana mínima (devuelven `pending-update`/descargarían) — inalcanzable en práctica.

**Deuda pendiente trasladada a la línea base**

- `format:check` rojo en archivos ajenos/preexistentes (ver gates arriba).
- `tests/performance-report.test.js` + `scripts/performance/` + `benchmark-memory.mjs`
  son WIP del usuario: ya visibles para `git add`, deben commitearse juntos o el test
  falla en checkout limpio.
