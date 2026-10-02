# Auditoría de código muerto

El objetivo es reducir código sin cambiar comportamiento observable. La ausencia
de referencias estáticas es una pista, no una prueba de que algo pueda borrarse.

## Procedimiento

1. Leer `AGENTS.md`, `git status`, `git diff` y `git diff --cached`. Conservar los
   cambios previos y delimitar los archivos autorizados.
2. Buscar nombres completos y prefijos en fuentes, tests, scripts, configuración
   y recursos. Incluir archivos ocultos y scripts versionados aunque coincidan
   con `.gitignore`; excluir binarios y salidas generadas de la evidencia de uso.
3. Clasificar cada candidato: alta (eliminación demostrablemente inocua), media
   (posibles consumidores indirectos) o baja (requiere cambiar diseño o lógica).
4. Reportar archivo, línea previa, evidencia y motivo antes de editar. Aplicar
   solo alta confianza, en rondas pequeñas. No borrar archivos ni dependencias
   únicamente por no encontrar imports.
5. Ejecutar después de cada ronda `npm run lint`, `npm run format:check` y
   `npm test`; también `npm run test:python` cuando se modifique Python. Conservar
   la salida real y distinguir tests omitidos de tests aprobados.

## Falsos positivos de Beru

- Electron conecta handlers mediante strings: comprobar main, preload, renderer,
  protocolos, eventos e imports dinámicos antes de tocar símbolos o archivos.
- Python conserva reexports en `processor.py` usados por tests y monkeypatching;
  revisar también PyInstaller, hidden imports y atributos consumidos por ctypes.
- Claves i18n, variantes CSS y clases Tailwind pueden construirse dinámicamente.
  Buscar prefijos, interpolaciones, `classList`, atributos y configuración de
  contenido. En selectores agrupados, no borrar reglas que contengan una clase viva.
- Un selector Zustand puede existir para provocar renders, aunque no se lea su
  resultado local. Quitar una suscripción puede modificar comportamiento.
- Las dependencias de hooks controlan cuándo se ejecuta lógica. Un aviso de
  ESLint no autoriza a cambiar reinicios, listeners o invalidación de cachés.
- Parámetros posicionales y exports pueden ser contratos aunque parezcan sin uso.
- Dependencias pueden servir a CLI, build, empaquetado o imports con efectos.

## Ronda del 2026-09-04

Las líneas siguientes corresponden al estado anterior a esta ronda.

### Aplicado: alta confianza

| Archivo y línea                      | Evidencia y cambio                                                                                                                                                                  |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/features/pets/pets.css:1–277`   | Eliminadas 43 reglas exclusivas del panel antiguo. Las clases no tienen consumidores en fuentes, tests, scripts ni recursos, y los prefijos dinámicos examinados no las construyen. |
| `src/features/pets/pets.css:265`     | Eliminado `skeleton-shimmer`: sus únicos dos consumidores eran skeletons eliminados en esta ronda.                                                                                  |
| `src/components/StatusFooter.jsx:41` | Eliminada únicamente la variable local `queueLength`. Se mantiene `queueLength: s.queue.length` en el selector y se añade una prueba que cambia solo la longitud de la cola.        |

Se conservan las reglas compartidas de tarjetas, sprites, carga y estado vacío.
La comparación textual con el estado previo verifica que el resto del CSS no
cambió. Esto no sustituye una prueba visual completa de Electron.

### Pendiente: confianza media, sin modificar

| Archivo y línea                                                         | Motivo para conservar                                                                                                                                         |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/components/Header.jsx:137`                                         | El efecto de capacidad lee `get`; revisar estabilidad del getter y debounce antes de cambiar dependencias.                                                    |
| `src/components/TableEditor.jsx:105`                                    | Añadir `queue` al efecto podría reiniciar tiempo y reproducción al editar la cola.                                                                            |
| `src/components/TextOverlay.jsx:87`                                     | Revisar `screen` y `scaleY` con pruebas de autoajuste y medidas; añadirlos cambia cuándo se mide.                                                             |
| `src/components/VideoPreview.jsx:270,332`                               | Añadir selección o duración puede volver a limpiar regiones o reiniciar preview, reproducción y zoom.                                                         |
| `src/components/video-preview/useZoomPan.js:48,74`                      | `videoRef` es estable en el consumidor actual; no cambiar el contrato para referencias reemplazables dentro de una limpieza.                                  |
| `src/features/pets/settings/PetdexPanel.jsx:81`                         | `getGalleryPets()` lee el store indirectamente. `petInstalled` y `petManifestLoading` invalidan el memo y no son código muerto.                               |
| `src/stores/slices/watermarkSlice.js:1`, `src/utils/video-utils.js:121` | Mantener parámetros posicionales aunque no se lean.                                                                                                           |
| `python/processor.py:40–70`                                             | Mantener los reexports usados como superficie de compatibilidad por tests.                                                                                    |
| `package.json:28–41`                                                    | Geist, class-variance-authority, tw-animate-css y shadcn requieren comprobar CLI y empaquetado antes de retirarlos. No se modifican dependencias ni lockfile. |
| `src/index.css`, resto de `src/features/pets/pets.css`                  | Candidatos adicionales requieren revisar selectores agrupados, variantes y ambas ventanas de Electron.                                                        |
| `tests/e2e.placeholder.test.js`, `tests/audit-config.test.js`           | Los tests omitidos no prueban comportamiento. No habilitar placeholders como si fueran E2E reales.                                                            |

Los avisos React de `act(...)` requieren aislar las actualizaciones asíncronas en
los tests que los generan; no silenciar `console.error` globalmente para ocultarlos.

## Ronda del 2026-09-08

Las líneas siguientes corresponden al estado anterior a esta ronda.

### Aplicado: alta confianza

| Archivo y línea                                          | Evidencia y cambio                                                                                                                                                   |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/features/pets/utils/pet-doctor.js`                  | Archivo completo eliminado junto a `tests/pet-doctor.test.js`: `diagnosePetSetup` solo era llamado por su propio test.                                               |
| `src/features/pets/index.js:7`                           | Eliminado el export lazy `PetdexPanel` sin consumidores (`SettingsModal.jsx` importa el componente directamente).                                                    |
| `src/utils/job-manifest.js`                              | Eliminados `isJobManifest` y la reexportación de constantes, vivos solo por su test. El validador real es `main/utils/jobManifest.js`; el test importa de `shared/`. |
| `main/utils/jobManifest.js:5,28`                         | Eliminado el campo `warning` del retorno de `unwrapJobManifest`: ningún consumidor lo lee; tests actualizados.                                                       |
| `main/handlers/process.js:457`                           | Eliminada la rama `if (settled)` inalcanzable en `onClose`: `cleanupChildListeners` ya retira el listener `close` y `settleRun` tiene su propio guard.               |
| `main/handlers/process.js` + `processing-run.js`         | `unlinkTmpArtifacts` movido a `processing-run.js` como export; la elimina la copia local y el bloque inline idéntico del watchdog.                                   |
| `main/handlers/preset.js:75`, `main/utils/presets.js:14` | `.beru.json` subsumido por `.json` en el filtro de extensión.                                                                                                        |
| `main/utils/settings.js`                                 | Eliminado `settingsCache`/`BERU_SETTINGS_CACHE`: flag opt-in sin ningún activador en el repo.                                                                        |
| `main/utils/processor-spawn.js`                          | Eliminado `bundledProcessorCache`/`BERU_PROCESSOR_SPAWN_CACHE`: mismo patrón de flag muerto.                                                                         |
| `main/shared-state.js`, `window.js`, `pet-overlay.js`    | `DEV_URL` duplicado literal en dos archivos movido a `shared-state.js`.                                                                                              |
| `main/handlers/updater.js`, `preload.cjs:44`             | Eliminado el canal `shell:openExternal` y sus helpers de validación: ningún llamante en el renderer (la feature fue reemplazada por `updater:check`).                |
| `main/utils/beru-protocol.js`                            | `statCache` (Map con TTL pero sin límite) ahora tiene cap de 500 con evicción por inserción, igual que `videoInfoCache`.                                             |
| `main/utils/petdex.js:417`                               | Eliminado `isBundledPetAvailable`: solo su test lo usaba.                                                                                                            |
| `src/features/pets/hooks/usePetState.js`                 | `summarizeQueue` local reemplazado por el export de `src/utils/execution-history.js` (el campo extra `cancelled` no se lee).                                         |
| `src/utils/updateState.js:87`                            | Eliminado `return { ...IDLE_UPDATE }` duplicado tras el branch de `checking`.                                                                                        |
| `python/beru-processor.spec:3`                           | Eliminado `import sys` sin uso.                                                                                                                                      |
| `python/processor.py`                                    | Eliminados `preview_frame_main` y la rama argv `--preview-frame` (solo `--preview-frame-worker` tiene consumidores).                                                 |
| `python/processor.py:1592`                               | `else: continue` en `build_filter_complex`: un `mode` desconocido incrementaba `n` sin emitir `[tmpN]` y corrompía la cadena de labels.                              |
| `python/processor.py`                                    | `_resolve_font_cache` ahora acotado (256 entradas, evicción por inserción).                                                                                          |
| `python/processor.py`                                    | `StderrBuffer.append` decrementaba mal `_chars` cuando `deque(maxlen)` evictaba; corregido.                                                                          |
| `python/processor.py`                                    | `_run_ffmpeg_stream` ahora mata FFmpeg si el bucle de polling lanza excepción (evitaba procesos huérfanos en retry).                                                 |
| `python/processor.py`                                    | `render_preview_frame`: `wait()` con timeout tras kill en timeout y kill+wait en el path de excepción general.                                                       |
| `python/processor.py`                                    | `find_ffmpeg`: lista de un candidato simplificada; `find_ffprobe`: candidato duplicado eliminado (`with_name` ya lo cubre).                                          |
| `python/processor.py:1413`                               | Docstring de `_build_watermark_filter` corregido (el segundo elemento es la posición overlay, no un flag booleano).                                                  |
| `python/delogo_chains.py`                                | Fallback recursivo a blur triplicado extraído a `blur_fallback()`; `_build_padded_region` se calcula solo en el path genérico (era inalcanzable-None tras clamp).    |
| `python/batch_errors.py`                                 | Mensaje de fuente no encontrada duplicado consolidado en `_FONT_NOT_FOUND_MSG`.                                                                                      |
| `python/test_preview_frame_limits.py`                    | `FakeProcess.__enter__/__exit__/communicate` nunca ejercitados; eliminados.                                                                                          |
| `python/test_delogo_feather0.py:63`                      | `if chain is None: return` silenciaba un posible fallo; ahora `assert chain is not None`.                                                                            |
| `tests/main-quit-during-probe.test.js`                   | Contexto VM actualizado con stubs `setPythonProcess`/`unlinkTmpArtifacts` para el nuevo import.                                                                      |
| `tests/process-double-signal.test.js`                    | El test fijaba el guard muerto de `onClose`; ahora fija el mecanismo real (early return de `settleRun` + `removeListener("close")`).                                 |
| `tests/shell-handlers.test.js`                           | Eliminado el caso `shell:openExternal` y su mock junto al canal retirado.                                                                                            |

### Pendiente: confianza media, sin modificar

| Archivo y línea                                                        | Motivo para conservar                                                                                                                          |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `RegionBlurPreview.jsx` + `DelogoLivePreview.jsx`                      | Draw-loops RAF/throttle casi idénticos (~80 líneas) con diferencias sutiles de timing; la extracción a hook compartido es un refactor aparte.  |
| `python/processor.py` — validación `font_path`                         | El campo se valida pero el render real usa `font`/`_resolve_font`; retirar la validación reduce superficie de contrato y queda para decisión.  |
| `python/processor.py:551` `_ANIMATED_IMAGE_EXTS`                       | `.apng/.avif/.mng` no pasan la validación actual, pero el set es whitelist semántica de formatos animados; conservar como cobertura defensiva. |
| `python/delogo_chains.py:160` fallback de `_build_cleanup_filter`      | Inalcanzable por callers normalizados; se conserva como defensa de un builder de grafos puro.                                                  |
| `python/delogo_chains.py` `_fit_delogo_rect`                           | Devuelve tupla neutral en vez de `None`; usado por tests y caller.                                                                             |
| `main/videoProbe.js` doble interceptación de quit                      | Defensiva ante registros múltiples; coste mínimo.                                                                                              |
| `main/processing-run.js` `getIsProcessing`                             | API de lock documentada; solo la leen tests.                                                                                                   |
| `main/utils/pathSecurity.js` `approvedWritePaths`                      | Set sin cap: las rutas se consumen (`delete`) en el uso normal; el crecimiento es teórico y acotarlo cambia semántica.                         |
| `package.json` devDep `shadcn`                                         | CLI de scaffolding intencional; retirarla no cambia runtime. `radix-ui` meta-paquete es sustituible por subpaquetes pero con bajo valor.       |
| `python/processor.py` `subprocess.run(capture_output=True)` en ffprobe | El buffer completo es deliberado (timeout corto, salida acotada).                                                                              |
| Tests Python con `tempfile.mkdtemp` sin cleanup                        | Los temporales los recoge el SO; añadir cleanup es cambio aditivo sin valor de comportamiento.                                                 |
| `src/components/ui/tooltip.jsx` listeners a nivel módulo               | Singleton intencional, no acumulativo.                                                                                                         |
| `src/stores/useEditorStore.js` suscripciones singleton                 | Diseño deliberado del store global.                                                                                                            |

### Notas de verificación

- Gate completo tras la ronda: `npm run lint` ✓, `npm run format:check` ✓,
  `npm test` ✓ (118 archivos, 724 tests), `npm run test:python` ✓.
- El delta de tests (-6 tests, -1 archivo frente a la línea base) corresponde
  exactamente a los tests eliminados junto a su dead code (`pet-doctor`,
  `isJobManifest`, `shell:openExternal`).

## Ronda 2 del 2026-09-08

Segunda pasada tras un barrido nuevo de exports (`src/utils`, `src/hooks`,
`src/lib`, `main/utils`, `main/handlers`, `main/`, `shared`, `src/features`,
`src/components`, `src/stores`, `src/i18n`) y de `def` en `python/` (con tests
y monkeypatching contados como uso).

### Aplicado

| Archivo y línea                                   | Evidencia y cambio                                                                                                                                                                                                   |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/utils/text-layout.js:51,83`                  | Eliminados `getTextLayoutCss` y `elementOverflows`: helpers legados vivos solo por sus tests; `text-preview-export-parity.test.js` ya prohibía el primero.                                                           |
| `main/handlers/process.js` — `settleRun`          | Los dos brazos (run actual / no actual) compartían cleanup; fusionados. `setPythonProcess(null)` es incondicional si es current o si apunta a este proc.                                                             |
| `RegionBlurPreview.jsx` + `DelogoLivePreview.jsx` | Draw-loop rAF/throttle (~55 líneas idénticas) extraído a `video-preview/use-throttled-video-draw.js`. Diferencias parametrizadas: `getRegion`, `paint`, `afterDraw`, `resumeEvents` (loadeddata solo en RegionBlur). |

### Conservado (verificado como vivo o seam intencional)

| Símbolo                                            | Motivo                                                                                                                                          |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `resetSessionWriteCache`                           | Seam de tests: resetea memoización interna de `session-persist.js`; sin él los tests comparten estado.                                          |
| `AUTO_TARGET_WORKERS`                              | Constante-nombre que los tests usan para fijar el objetivo auto=5; documenta el invariante.                                                     |
| `invalidateBeruStatCache`                          | Seam de tests para aislar el `statCache`.                                                                                                       |
| `getIsProcessing`, `PROCESSING_LOCK_MAX_MS`        | API de lock documentada; solo tests la leen.                                                                                                    |
| Exports "testonly" restantes                       | Todos tienen uso interno real (`operationToJobPayload`, `flattenExecutionHistory`, `safePetSlug`, `parseFfprobeJson`, `wrapTextToWidth`, etc.). |
| `fmtTime` vs `formatFooterClock`                   | Formatos distintos (`m:ss` vs `mm:ss`); unificarlos cambiaría la UI.                                                                            |
| `main/videoProbe.js` doble registro de quit        | Defensiva deliberada.                                                                                                                           |
| `font_path` (validación)                           | Contrato; el render usa `font`/`_resolve_font`. Dejar para decisión de diseño.                                                                  |
| `subprocess.run` capture_output, tempdirs de tests | Deliberado / sin valor observable.                                                                                                              |

### Verificación

`npm run lint` ✓ · `format:check` ✓ · `npm test` ✓ (118 archivos / 721 tests;
delta -3 = los casos de los helpers eliminados). Sin cambios Python esta ronda.

## Ronda del 2026-09-29

Barrido completo del repo (src/, main/, shared/, python/, scripts/, tests/,
deps y configs) sobre el refactor de consolidación en curso en el working tree.

### Aplicado: alta confianza

| Archivo y línea                                                                        | Evidencia y cambio                                                                                                                                                            |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main/preload.cjs:46` + `main/handlers/petdex.js:8,43-49` + `main/utils/petdex.js:381` | Cadena `petdex:uninstall` eliminada de las tres capas: `rg uninstall` no encuentra ningún consumidor en `src/`; nadie podía invocarla. Mismo patrón que `shell:openExternal`. |
| `tests/petdex-handlers.test.js:145`                                                    | Eliminado el caso "uninstalls an installed pet": solo ejercitaba el canal retirado.                                                                                           |
| `tests/settings-pets.test.jsx:45`                                                      | Eliminado el mock `uninstallPet` del objeto `window.api`: ya no existe en preload.                                                                                            |
| `package.json:18` (`test:python`)                                                      | Restaurado `python/test_text_layout_fixtures.py`: estaba en HEAD, el refactor lo perdió al reescribir el script y el archivo no fue borrado. Pasa standalone (6/6).           |
| `DESIGN.md:78`                                                                         | Referencia stale a `inspector/SegmentedControl.jsx` corregida a `SegmentedToolbar.jsx` (renombrado en el refactor).                                                           |

### Pendiente: confianza media, sin modificar

| Archivo y línea                                                                                                  | Motivo para conservar                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main/handlers/preset.js:19-26` + `main/utils/presets.js`                                                        | Rama `bundled`: `resources/presets/` y su `extraResources` fueron eliminados en el refactor, pero el renderer sigue consumiendo `source === "bundled"` (PresetManager, ProjectMenus, projectSlice, i18n). Retiro a medias: decisión de producto pendiente. |
| `src/utils/processing-logs.js` + `logLines` (processingSlice)                                                    | `formatProcessingLogs` sin consumidores y `logLines` es estado write-only; el cap de 200 está fijado por `stability-load.test.js`. Posible seam de una futura vista de logs.                                                                               |
| `main/utils/concurrency.js` param `fallback`                                                                     | Los callers de producción no lo pasan; solo `tests/concurrency.test.js`. Contrato testeado.                                                                                                                                                                |
| `python/delogo_chains.py:166`, `_build_padded_region`, `_fit_delogo_rect`, `processor.py` `StderrBuffer.__len__` | Fallbacks defensivos y dunder sin uso; la convención del repo conserva las ramas defensivas de builders puros.                                                                                                                                             |
| `python/build_excel_template.py`                                                                                 | Generador one-off con path hardcodeado; herramienta de regeneración del fixture commiteado.                                                                                                                                                                |
| `eslint.config.js` ignores (`dist-electron`, `terminals`, `agent-tools`, `.tmp-harness`)                         | Directorios inexistentes hoy; ignores defensivos de coste nulo (`terminals`/`agent-tools` están en `.gitignore`).                                                                                                                                          |
| Scripts npm `preview`, `start`, `test:coverage`, `test:watch`                                                    | Conveniencias estándar sin referencias cruzadas.                                                                                                                                                                                                           |

### Conservado (verificado como vivo)

- Todas las deps de `package.json` tienen consumidor (`radix-ui` meta-paquete
  via namespace imports en `src/components/ui/`; `geist`, `class-variance-authority`
  y `tw-animate-css` ya fueron eliminadas del manifiesto).
- Los 47 canales IPC restantes mapean preload ↔ handler ↔ renderer.
- Test seams documentados intactos (`getIsProcessing`, `invalidateBeruStatCache`,
  `resetSessionWriteCache`, `PROCESSING_LOCK_MAX_MS`, `AUTO_TARGET_WORKERS`).
- `scripts/dev-python-watch.mjs` `shouldRestartElectronForPythonChange`: su
  consumidor `dev.mjs` está gitignored; vivo en el entorno real.

### Verificación

`npm run lint` ✓ · `format:check` ✓ · `npm test` ✓ (126 archivos / 804 tests;
delta -1 = el caso del canal `petdex:uninstall` retirado) · `npm run test:python`
✓ (23 archivos, incluye `test_text_layout_fixtures.py` restaurado).

## Auditoría de tests — 2026-09-29

Barrido de `tests/**/*.test.{js,jsx}` y `python/test_*.py` con la skill
`test-audit` (5 carriles por propietario + verificación manual). Criterio:
borrar solo lo que no detecta ningún fallo que otra prueba no cubra ya, o lo que
solo existe para sostener código de producción sin consumidores.

Corrección a la ronda del 2026-09-08: la entrada "exports testonly" afirmaba que
`flattenExecutionHistory` tenía uso interno real; tras el refactor (panel de
historial eliminado) su único consumidor era el propio test. Eliminado en esta
ronda junto a `formatRunHeader`/`formatHistoryTimestamp`, que solo existían
para él.

### Aplicado: alta confianza

| Archivo y línea                                                          | Evidencia y cambio                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/utils/processing-logs.js` + `tests/processing-logs.test.js`         | Archivos eliminados. `formatProcessingLogs` no tenía consumidores; `appendProcessingLog` solo alimentaba `logLines`, estado write-only (nadie lo lee; las mismas líneas viven en `executionHistory[].lines` con el mismo cap de 200 vía `appendLineToRun`). |
| `src/stores/slices/processingSlice.js`                                   | Eliminados el import, `logLines: []` inicial y las cuatro escrituras (`appendLog`, `appendLogBatch`, `clearExecutionHistory`, `startExecutionRun`). Sin lectores: inerte.                                                                                   |
| `src/utils/execution-history.js:87-124`                                  | Eliminados `flattenExecutionHistory`, `formatRunHeader` y `formatHistoryTimestamp`: cero llamadas en producción.                                                                                                                                            |
| `tests/execution-history.test.js`                                        | Eliminado el `it` dedicado a `flatten` y las aserciones sueltas de otro caso; el resto del archivo cubre helpers vivos del slice.                                                                                                                           |
| `tests/stability-load.test.js`                                           | Eliminado el `it` del cap de `logLines` (el cap real lo fija `appendLineToRun`, cubierto por `execution-history.test.js`) y el literal `logLines`.                                                                                                          |
| `tests/{store.logic,export-pipeline,status-footer,header-batch-summary}` | Eliminados los literales `logLines: []` en `setState`.                                                                                                                                                                                                      |
| `tests/delogo-cover-ui.test.jsx`                                         | Eliminado el `it` "renders an image picker": sonda de render subsumida por los dos tests siguientes, que montan el mismo panel y ejercitan el mismo botón.                                                                                                  |
| `tests/beru-protocol.test.js`                                            | Eliminado el `it` "handler refuses unmapped type": re-afirmaba `.xlsx → false`, ya cubierto por el `it.each` de la línea 142; el archivo temporal era trabajo muerto (la función solo lee la extensión).                                                    |
| `tests/path-security.test.js`                                            | Eliminado el `it` "session restore style": reimplementaba el bucle del handler en línea; el rechazo fuera-de-raíz ya lo cubre el test de la línea 136 y el canal real `session:restorePaths` tiene su propio test.                                          |
| `tests/encode-profile-contract.test.js`                                  | Eliminado el `it` de `resolveBatchWorkers` (duplicado exacto de `batch-workers.test.js` — fuera de carril: este archivo posee el contrato de perfiles) y sus imports `os`/`resolveBatchWorkers`.                                                            |
| `tests/process-run-scoped-events.test.js`                                | Endurecidas las regex vacuas (`toContain("runId")` y `[\s\S]*runId` pasaban trivialmente): ahora exigen `runId` dentro del payload emitido (`sendToRenderer("process:finished", {...runId})`).                                                              |
| `python/test_normalized_fonts_cache.py`                                  | Eliminado `patch.object(processor, "get_system_fonts")`: `_get_normalized_fonts` recibe el catálogo por parámetro y nunca llama a la función parcheada — mock inerte y engañoso.                                                                            |
| `python/test_delogo.py`                                                  | Eliminado el shim `def test_delogo_filter_graphs()` para pytest: nada corre pytest en el repo (`test:python` invoca el script directamente).                                                                                                                |

### Pendiente: confianza media, sin modificar

| Archivo y línea                                                                                                   | Motivo para conservar / investigar                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `executionHistory` completo (slice + IPC `executionHistory:*` + `main/utils/execution-history.js` + persistencia) | Tras borrar `ExecutionHistoryPanel.jsx` ningún componente lee el estado, pero la carga al arranque y la persistencia a disco siguen cableadas — feature a medio retirar; decisión de producto del refactor. |
| `tests/sign-out.test.jsx` "returns to the login screen"                                                           | El mock ejecuta la transición asertada; la parte única (BeruRoot monta `ConfirmDialog`) podría quedar descubierta — requiere reescritura, no borrado.                                                       |
| `tests/updater-flow.test.jsx` ↔ `tests/status-footer.test.jsx`                                                    | Dos mitades distintas con solape real (mismo harness, mismo fixture 9.9.9): candidato a consolidación, no a borrado de archivo.                                                                             |
| `tests/updater-flow.test.jsx` aserciones `getComputedStyle`                                                       | jsdom no carga CSS: pasan vacuas. Endurecer requiere otra estrategia (inline style o clase).                                                                                                                |
| `tests/region-interaction.test.js` `RESIZE_HANDLES` length                                                        | Conteo de constante privada ya cubierto por el DOM boundary test (`applied-delogo-edit` cuenta 8 handles renderizados).                                                                                     |
| `tests/runtime-dependencies.test.js` describe de `translateProcessorErrorMessage`                                 | Duplicado de `process-input-validation.test.js`; coste de mantenerlo ~nulo.                                                                                                                                 |
| `python/test_preview_frame_limits.py` `FakeProcess.poll`                                                          | Método no ejercitado pero modela la interfaz real de `Popen`.                                                                                                                                               |
| `python/test_delogo.py` vs `test_delogo_robust.py`                                                                | Solape parcial de parses ffmpeg reales (mirror/combos/tiempo solo en delogo.py); consolidación parcial posible, no borrado.                                                                                 |
| Fixtures PPM/rawvideo en 4 archivos Python                                                                        | Misma rutina de decodificar un frame reimplementada 4 veces; candidato a helper compartido, refactor aparte.                                                                                                |
| `tests/batch-panel.test.jsx`, `tests/app-render.test.jsx` (flex-nowrap)                                           | Inventario de labels i18n y clase Tailwind: frágiles pero son el guard barato de contrato UI; conservar-investigar.                                                                                         |

### Verificación

Tests focalizados de los 13 archivos tocados: 146/146 ✓. Gate completo:
`npm run lint` ✓ · `format:check` ✓ · `npm test` ✓ (125 archivos / 790 tests;
delta −1 archivo y −14 tests = exactamente lo retirado) · `npm run test:python` ✓
(23 archivos; `test_delogo.py` 20/20, `test_normalized_fonts_cache.py` 2/2).

## Ronda 3 — retirada de features a medio quitar (2026-09-29)

Pasada ambiciosa tras la auditoría de tests: el refactor había retirado la UI de
dos features pero dejó sus pipelines cableadas. Ambas se eliminan por completo.

### Feature `executionHistory` — eliminada entera

Tras borrar `ExecutionHistoryPanel.jsx` ningún componente leía el estado: el
historial se cargaba al arranque, se acumulaba y se persistía a disco sin que
nada lo mostrara. Retirado:

- `src/utils/execution-history.js` — archivo eliminado. `summarizeQueue` era la
  única función con consumidor vivo (`usePetState`, celebración del pet al
  terminar un lote): movida a `src/utils/batch-process.js` con cobertura nueva
  en `tests/batch-process.test.js`.
- `main/handlers/execution-history.js` y `main/utils/execution-history.js` —
  archivos eliminados (3 canales `executionHistory:*` y la persistencia a
  `userData/execution-history.json`).
- `main/preload.cjs` — eliminados `listExecutionHistory`, `saveExecutionHistory`,
  `clearExecutionHistory`.
- `main/main.js` — eliminados import y registro.
- `src/stores/slices/processingSlice.js` — eliminados `executionHistory`,
  `activeExecutionId`, `loadExecutionHistory`, `clearExecutionHistory`,
  `startExecutionRun`, `finalizeActiveExecution`, `appendLog`, `appendLogBatch`,
  `schedulePersistExecutionHistory` y las ramas de historial en
  `setBatchSummary`/`setProcessing`. `processingHooks` queda con 4 campos.
- `src/hooks/useProcessing.js` — eliminados el handler `onLog`, el buffer
  `pendingLogs`/`flushLogs` y las llamadas a `finalizeActiveExecution`.
- `src/utils/batch-runner.js` — eliminadas las llamadas a hooks de historial.
- `src/App.jsx` — eliminada la carga al arranque.
- `src/utils/perf-flags.js` — eliminado `PERF_FLAGS.logBatch` (solo servía al
  buffer de logs).
- Cadena `process:log` eliminada: emits en `main/handlers/process.js` (ramas
  `else`/catch sobre stdout no-JSON) y `api.onLog` en preload. Sin consumidores.

`batchSummary` sobrevive (lo renderizan `StatusFooter` y `Header`); para
conservar el reset al iniciar un run que antes hacía `startExecutionRun`, los
patches `createBatchStartPatch`/`createSingleStartPatch` ahora incluyen
`batchSummary: null`.

Tests: eliminado `tests/execution-history.test.js` (sus asserts vivos de
`summarizeQueue` se reubicaron), el `it` "preserves prior execution runs" de
`store.logic.test.js`, las aserciones/mocks de hooks de historial en
`batch-runner.test.js`, las semillas `executionHistory`/`activeExecutionId` de
`use-processing-error`/`use-processing-nonzero-exit`, la entrada
`registerExecutionHistoryHandlers` del harness vm de `main-crash-diagnostics`,
la fila `onLog` de `preload-subscriptions`, mocks `onLog` en
`app-render`/`auth-boot-gate`/`app-update-check`, y literales en
`status-footer`/`updater-flow`/`header-export`.

### Feature presets bundled — eliminada entera

El refactor ya había borrado `resources/presets/*.beru.json` y su entrada
`extraResources`; la rama `source === "bundled"` era inalcanzable (la clase
`.is-bundled` ni siquiera tenía reglas CSS). Retirado:

- `main/handlers/preset.js` — `presets:list` ya no escanea el directorio bundled.
- `main/utils/presets.js` — `readPresetsFromDir` pierde el parámetro `source` y
  el campo `source` del payload.
- `src/stores/slices/projectSlice.js` — eliminado el guard de bundled en
  `deletePreset`.
- `src/components/PresetManager.jsx` — eliminadas las ramas `isBundled` (tag
  "Incluido", title alternativo, delete condicional).
- `src/components/ProjectMenus.jsx` — eliminado el agrupado por secciones
  Bundled/Custom y `hasMultipleSources`.
- i18n: eliminadas `modal.preset.bundled`, `modal.preset.bundledCannotDelete`,
  `header.presetsBundled`, `header.presetsCustom` en `en.json` y `es.json`
  (quedaban huérfanas por esta retirada; el sweep previo confirmó 0 huérfanas
  en las 580 keys restantes).
- `tests/store.deletePreset.test.js` — eliminado el test de rechazo bundled y
  los campos `source` stale del mock.

### Trims de tests (ronda 3)

- `tests/runtime-dependencies.test.js` — eliminado el `describe` de
  `translateProcessorErrorMessage` (duplicado de `process-input-validation`).
- `tests/region-interaction.test.js` — eliminado el conteo de `RESIZE_HANDLES`
  (los 8 handles los verifica el boundary test DOM de `applied-delogo-edit`).
- `python/test_preview_frame_limits.py` — eliminado `FakeProcess.poll` (ramas
  que lo llaman no se ejercitan en ningún test).

### Conservados tras verificación (no son basura)

- `summarizeQueue` — sigue vivo para la celebración del pet.
- `batchSummary` + `setBatchSummary` — consumidos por StatusFooter/Header y el
  evento `process:summary` de main.
- `i18n` — barrido completo: 0 keys huérfanas en las 580 restantes.
- Petdex `source: "bundled"` (catálogo de pets) — feature distinta y viva.
- Solapes documentados en la ronda anterior (updater-flow↔status-footer,
  `getComputedStyle` en jsdom, `sign-out` con mock-transición, fixtures PPM,
  `test_delogo`↔`test_delogo_robust`, `batch-panel`/`app-render`) — sin tocar.

### Verificación

`npm run lint` ✓ · `format:check` ✓ · `npm test` ✓ (124 archivos / 785 tests) ·
`npm run test:python` ✓ (23 archivos).

## Ronda 4 — CSS, estado write-only y trims media (2026-09-29)

Cuatro barridos en paralelo (CSS huérfano, campos de store sin lectores, archivos
y exports sin importers, funciones Python sin callers) más los trims media de la
auditoría de tests.

### CSS — `src/index.css` (~170 líneas eliminadas)

Reglas huérfanas eliminadas (selectores sin ninguna referencia en
`src/**/*.{js,jsx}` ni HTML):

- Bloque `.inspector-segmented*` completo (~104 líneas + entradas en la lista
  `prefers-reduced-motion`): el control segmentado se reescribió como
  `SegmentedToolbar` (`inspector-toolbar`/`inspector-chip`) y las reglas viejas
  quedaron sin elementos que las usaran.
- `.header-lang-code`, `.header-lang-chevron`, `.header-lang-trigger[open]` y su
  `prefers-reduced-motion` — `AppRail` solo emite `header-lang-item-code`.
- `.header-theme-toggle--slot1/--slot2` — sin emisor.
- `.header-presets-section` y su regla de separación — quedaron huérfanas al
  retirar el agrupado bundled/custom de `ProjectMenus` en la ronda 3.
- `.inspector-user-presets-tag` — era el tag "Incluido" de presets bundled.
- `.inspector-chrome-meta-empty` — `PropertiesPanel` solo emite `-key`/`-value`.
- `.cap-section` (la clase base sin uso; `cap-section-title` sigue viva).
- `.landing-card` dentro de `@media (max-width: 480px)`.

Bug latente corregido: `.queue-header-btn.cap-btn` nunca podía aplicar — los
`<button>` de `QueueSidebar` solo llevan `queue-header-btn`, así que el tamaño
28×28 previsto no se aplicaba. Selectores corregidos a `.queue-header-btn`.

Clases emitidas en JSX pero sin regla definida, eliminadas del markup (nulos
efectos): `cap-no-drag` en `StatusFooter` (la regla global `button { no-drag }`
ya cubre esos casos), `status-footer-progress-label` en `FooterChip`,
`opacity-slider` en `PetdexPanel`. Conservadas las bases BEM semánticas
(`app-header-icon-btn`, `settings-users`, `inspector-group--no-chevron`) — son
marcadores de superficie consultables aunque hoy no porten reglas propias.

### Estado write-only en el store (patrón `logLines`)

- `uiSlice`: eliminados los campos `theme` y `activeThemeRef` (se escribían en
  `applyActiveTheme`/`loadSettings`, nadie los leía; la persistencia a
  `settings.json` usa `slotToLegacyTheme`/`migrated.theme`, independiente).
- `projectSlice`: eliminada la clave `presetsUserDir` del `set` tras
  `savePreset` — se escribía pero nunca se leía ni se declaraba como estado.

### Tests — trims

- `tests/status-footer.test.jsx`: eliminado el `it` "auto-opens the install
  modal…" (nombre sobre-prometía: sembraba `updateModalOpen: true` y repetía el
  assert `installUpdate` ya cubierto por `updater-flow` conduciendo la
  transición real downloading→ready). Recortado del test del modal el click
  duplicado de "Actualizar ahora" → `downloadUpdate` (contrato cubierto en
  `updater-flow`); se conservan los asserts únicos (role=dialog, secciones
  Corregido/Mejorado, orden de botones).
- `tests/updater-flow.test.jsx`: eliminadas las dos aserciones
  `getComputedStyle` vacuas (jsdom no carga CSS: `overflowY`/`maxHeight` siempre
  pasan vacías).
- `python/test_logo_preview_export_parity.py`: eliminado el parámetro `fps`
  nunca usado de `_source_rgb` (6 callsites actualizados).

### Barridos sin hallazgos (verificados, no se tocaron)

- **Python**: 0 funciones con 0 callers — toda la cadena `main()` →
  `process_jobs` → `_execute_batch` y el worker de preview están vivas; imports
  y constantes module-level todos usados. `StderrBuffer.__len__` y los paths
  defensivos de `delogo_chains` ya estaban documentados como conservados.
- **Archivos**: ningún archivo sin importers en `src/`, `main/`, `shared/`.
- **Exports**: ninguno con 0 referencias; los exportados solo-para-tests son
  seams documentados (batch-process, session-persist, workerPolicy, petdex…).
- **npm deps**: todas usadas salvo `shadcn` (devDep CLI de scaffolding, decisión
  abierta — fuera de esta pasada).
- `sign-out.test.jsx` test 2: el mock hace la transición de auth, pero el test
  ejercita wiring real (BeruRoot compone `ConfirmDialog`); se conserva.
- Fixtures PPM/rawvideo ×4 archivos Python: duplicadas en espíritu pero con
  interfaces divergentes (bytes vs archivo vs numpy); consolidarlas exigiría un
  helper más ancho que la suma — documentado, no aplicado.
- Solape `test_delogo.py`↔`test_delogo_robust.py`: cobertura de parse ffmpeg
  real con casos no idénticos — conservado.

### Verificación

`npm run lint` ✓ · `format:check` ✓ · `npm test` ✓ (124 archivos / 784 tests) ·
`npm run test:python` ✓ (23 archivos) · `git diff --check` ✓.

## Ronda 5 — paridad IPC, wiring de tests Python y endurecimiento (2026-09-29)

Barridos de paridad post-retiradas: nada quedó colgando de las features
eliminadas (0 referencias a `executionHistory` fuera de este doc/CHANGELOG).

### Aplicado

- `src/index.css`: eliminados los 8 selectores alias legacy `.cap-btn-primary` /
  `-secondary` / `-tertiary` / `-danger` (base + `:hover`) — ningún elemento los
  emite (solo `cap-btn--*`). La regla contextual
  `.settings-appearance-slot-actions .cap-btn-secondary` apuntaba al spelling
  muerto — corregida a `.cap-btn--secondary` (mismo bug latente que
  `queue-header-btn.cap-btn` en la ronda 4).
- `python/test_text_layout_fixtures.py`: eliminado `from __future__ import
annotations` — sin anotaciones en el archivo.
- `mkdtemp` sin cleanup → `TemporaryDirectory`: `test_delogo_e2e.py:69` y
  `test_delogo_seamless.py:30` (module-level, limpieza al salir del intérprete)
  y `test_delogo_robust.py` `test_temporal_removes_static_logo` (local, limpieza
  al volver de la función).
- **Skip silencioso → fallo explícito**: `postinstall` garantiza `bin/ffmpeg.exe`;
  una ausencia es entorno roto y debe fallar (misma política que ya tenía
  `test_delogo_e2e.py`). Normalizados: `test_delogo.py` (`run_ffmpeg_parse` y la
  creación de la imagen cover, que antes descartaba el caso en silencio),
  `test_delogo_robust.py` (`assert_graph` + los dos e2e) y
  `test_delogo_seamless.py` (los dos e2e de métricas).

### Guards añadidos (previenen que estas clases de dead code vuelvan)

- `tests/preload-subscriptions.test.js`: nuevo `it` de paridad
  `ipcMain.handle` ↔ `ipcRenderer.invoke` — 49/49 simétricos. El primer intento
  del regex encontró una asimetría falsa (`petdex.js` usa `ipcMain.handle(`
  multilínea); el regex tolera `\s*` — el test ahora cubre esa forma.
- `tests/python-test-wiring.test.js` (nuevo): por cada `python/test_*.py`,
  todo `def test_*` top-level debe aparecer invocado en el archivo — sin
  discovery, un test sin llamada en su `__main__`/`tests` list no corre nunca.

### Verificados limpios (sin acción)

- **IPC**: 49/49 `ipcMain.handle` ↔ `ipcRenderer.invoke`; 12/12
  `sendToRenderer` ↔ `subscribe`; los 61 métodos de `window.api` tienen
  consumidor real en `src/`; los 13 handlers se registran desde `main.js`/
  `pets/index.js`.
- **Tests Python**: los 23 archivos invocan todas sus funciones `test_*`; sin
  imports ni constantes ni helpers muertos.
- **i18n**: tras el rediseño del Landing las 4 keys nuevas (`landing.or`,
  `landing.formats`, …) están consumidas y las viejas borradas en ambos
  diccionarios — paridad mantiene.
- **Docs**: CONTEXT.md/DESIGN.md sin referencias a features retiradas;
  CHANGELOG solo historial.
- `sign-out` test 2, fixtures PPM divergentes, solape delogo↔robust, clase
  `inspector-group--no-chevron` (marcador BEM sobre prop funcional), bases BEM
  `app-header-icon-btn`/`settings-users` — conservados (superficie semántica).
- `test_op_time_disabled.py:42` rama condicionalmente vacua — incierto si
  `filter_str=None` es legítimo; conservada.
- `shadcn` devDep: decisión abierta.

### Verificación

`npm run lint` ✓ · `format:check` ✓ · `npm test` ✓ (126 archivos / 811 tests —
+2 archivos por los guards nuevos y cambios del usuario) · `npm run test:python`
✓ (23 archivos) · `git diff --check` ✓.

## Ronda 6 — schema único de Job (2026-09-30)

La forma del Job estaba escrita tres veces con defaults duplicados. Se
consolidó en `shared/job-manifest.js` (`normalizeJob`/`normalizeManifest` +
`DEFAULT_PIX_FMT`); `createJobManifest`, `unwrapJobManifest` y
`createProcessorManifest` pasaron a ser adapters delgados.

### Aplicado

- `main/handlers/process.js` — eliminados `hasJobDimensions`, `hasExportMetadata`
  y `normalizeJobDimensions`: sus checks quedan subsumidos por
  `video_info_probed`, flag que `normalizeJob` calcula a partir de la presencia
  pre-default de dims+duration+pix_fmt (un `pix_fmt` por defecto no prueba que
  hubo probe). `applyProbeInfoToJob` pierde sus `|| default` redundantes sobre
  jobs ya normalizados.
- `src/utils/export-pipeline.js` — `buildExportJob` delega en `normalizeJob`;
  eliminados los `|| "yuv420p"`/`|| ""`/`|| 0`/`|| "balanced"` locales.
- `src/utils/video-dimensions.js` — `mergeProbeIntoQueueItem` consume
  `DEFAULT_PIX_FMT` en vez del literal.
- `main/utils/jobManifest.js` — la reparación de `id` no-entero se movió a
  `normalizeJob` (mismo comentario de invariante: Python reporta por posición).
- `tests/fixtures/job-manifest.js` — fixture compartido
  (`RAW_JOB`/`MINIMAL_JOB`/`MINIMAL_JOB_NORMALIZED`) consumido por
  `job-manifest.test.js` y `export-pipeline-facade.test.js`.
- `tests/logo-trim.test.jsx` — la aserción "sin trim" pasa de
  `not.toHaveProperty("trim_*")` a `trim_start: 0, trim_end: null` (contrato
  normalizado; Python trata ambas formas igual).
- Python sin cambios: `job.get` con fallback queda como tolerancia del boundary
  para manifests array legacy e invocaciones directas que nunca pasan por el
  schema JS.

### Verificación

`npm run lint` ✓ · `prettier` ✓ en los archivos tocados · tests de superficie
✓ (`job-manifest` 21, `export-pipeline-facade` 21, `batch-runner` 13,
`export-pipeline` 16, `logo-trim` 3). Línea base: `npm test` tiene 18 fallos en
6 archivos ajenos a este cambio (`processing-run`, `process-handler-run`,
`main-quit-during-probe`, `process-cancel-output-cleanup`,
`main-crash-diagnostics`, `main-fatal-kill-process-tree`) por el refactor de
run-model (`startRun`/`createCancelArtifacts`) en curso en el mismo worktree —
los harness VM de esos tests no stubbean aún la API nueva.
