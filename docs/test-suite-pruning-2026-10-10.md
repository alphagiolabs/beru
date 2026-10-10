# Poda de la suite — 2026-10-10

Se retiraron 57 casos Vitest y cuatro funciones de prueba Python por duplicación,
aserciones vacuas o dependencia de detalles internos. Las aserciones únicas se
trasladaron a pruebas que ejercitan el contrato. El saldo es de 438 líneas menos
en tests y soporte; producción, runners y configuración de CI no cambiaron.

## Alcance y línea base

- Criterios: [test-audit de OpenClaw](https://github.com/openclaw/openclaw/blob/main/.agents/skills/test-audit/SKILL.md),
  la [adaptación local](../.agents/skills/test-audit/SKILL.md) y
  [los falsos positivos de Beru](dead-code-audit.md).
- HEAD inicial: `d707a2da60a6dc0226237481f9778174a65d0b11`. El checkout tenía
  cambios preexistentes, incluidos tests y archivos sin seguimiento. Se tomó
  una copia de tests, Python, scripts y manifiesto antes de editar. Los 21
  archivos editados por esta poda estaban limpios en la línea base.
- El barrido cubrió renderer, main/shared, Python, herramientas y soporte.
  La aplicación se limitó a candidatos demostrados; no es un ledger exhaustivo
  de cada declaración del repositorio.
- [Vitest](../vitest.config.js) incluye `tests/**/*.test.{js,jsx}`.
  [El runner Python](../scripts/test-python.mjs) descubre los 38
  `python/test_*.py`. [CI](../.github/workflows/ci-release.yml) ejecuta
  `npm run verify` y repite Python para release. No se encontraron suites
  huérfanas ni omitidas por estos patrones; no se borraron tests por no correr.
- Línea base: `npm run verify`, exit 0; lint y formato aprobados, 180 archivos
  Vitest con 1.269 casos y 38 scripts Python aprobados.

## Evidencia y cobertura conservada

Las líneas son las del snapshot anterior al cambio. Cada fila se contrastó con
su propietario, consumidores, historial y ejecución efectiva. El riesgo de los
borrados es perder una aserción única; la columna de cobertura indica dónde queda.

| Test anterior                        | Qué verificaba y cambio                                                                                                                                                      | Propietario y consumidores reales                                                         | Prueba conservada e historia                                                                                                                                                                                                        |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status-footer.test.jsx:109,151,229` | Tres escenarios de modal, descarga y enlaces repetidos. Portar rol, textos, ausencia de instalación prematura y enlaces; retirar helper de montaje e import de UpdatePrompt. | StatusFooter y UpdatePrompt, montados por App y BeruRoot.                                 | [updater-flow](../tests/updater-flow.test.jsx): disponible/descargando/listo, IPC, clic del badge y orden del contenido. Originales `fcc413bf`, `770fd92f`, `1b90c58a`; keeper `adf09a3c`, `f14abb96`, `1c80a68c`.                  |
| `store.queue.test.js:312`            | Sufijos de tres salidas; retirar duplicado.                                                                                                                                  | queueSlice, QueueSidebar y processingSlice.                                               | [store.queue](../tests/store.queue.test.js): siete salidas esperadas explícitas, incluidas colisiones múltiples y nombres con puntos. Ambos `5b2bd89`.                                                                              |
| `sanitize-preset.test.js:154`        | Watermark sin imageV y restauración con versión vacía; retirar describe e imports.                                                                                           | sanitize-preset, persistencia de sesión, proyectos y presets.                             | [session-persist](../tests/session-persist.test.js): enabled, path, opacity e imageV desde build/parse reales. `0d5a9104`, actualizados en `d707a2da`.                                                                              |
| `session-persist.test.js:140`        | El fixture escribe y lee Storage directamente; no ejerce writer ni reader. Consolidar en el caso de escrituras sin cambios.                                                  | session-persist, consumidor useEditorStore.                                               | [session-persist](../tests/session-persist.test.js): writer real, clave literal, JSON con cola/destino, reader real y una sola escritura. `71799d1`, `6c0c1ac`, `5b2bd89`.                                                          |
| `store.batch.test.js:62`             | Reaplicar Excel con estilos globales; portar cuatro campos de sombra y matching.                                                                                             | batchSlice → reconcileBatchExport → applyBatchTextOperations; ExcelMappingModal y export. | [export-pipeline](../tests/export-pipeline.test.js): misma updateExcelMapping, estilos globales y overrides de template. Original `5b2bd89`; keeper `d597a873`, `5b2bd89`.                                                          |
| `store.batch.test.js:416`            | Materializar texto desde Excel; absorber en el caso con undo.                                                                                                                | setTextForRegion, usado por edición batch y TableEditor.                                  | [store.batch](../tests/store.batch.test.js): índice, texto, región, batchRegionId, fontSize y un único paso de undo. Ambos `5b2bd89`.                                                                                               |
| `app-render.test.jsx:121`            | Smoke de montaje cuyo único resultado era demo.mp4. Portar esa aserción.                                                                                                     | App y preview batch.                                                                      | [app-render](../tests/app-render.test.jsx): controles de región batch y filename visible. Original `ffb44a6`, `d597a873`; keeper `2aa2903`, `231d602`.                                                                              |
| `export-pipeline.test.js:89`         | Solo comprobar delogo_method=inpaint; retirar duplicado.                                                                                                                     | prepareRun y buildExportJob, consumidos por processingSlice.                              | [export-pipeline](../tests/export-pipeline.test.js): job con blur/delogo/text y export real. Ambos `d597a873`, migrados en `5b2bd89`.                                                                                               |
| `export-pipeline.test.js:454`        | Replay directo de filterOperationsForExport; portar vacío y blur, retirar import.                                                                                            | operation, consumido por buildExportJob.                                                  | [operation](../tests/operation.test.js): payload real filtra whitespace, texto vacío e imagen vacía y conserva texto/delogo/blur en orden. Original `d597a873`; keeper `0d5a9104`.                                                  |
| `beru-protocol.test.js:233`          | Regex sobre contentTypeFor exige `\|\| null`, sin comprobar lo que promete su título. Retirar grep.                                                                          | beru-protocol, llamado por main.                                                          | [beru-protocol](../tests/beru-protocol.test.js): extensiones desconocidas rechazadas por hasKnownBeruType; guard 403 y CORS conservados. `5b2bd89`.                                                                                 |
| `main-quit-update.test.js:10`        | Misma guarda global que el caso siguiente, más nombre privado interceptQuitIfProcessing. Consolidar.                                                                         | main y cierre para instalación de update.                                                 | [main-quit-update](../tests/main-quit-update.test.js): guarda de update y registros before/will quit. `f14abb96`, `88b4c8e0`.                                                                                                       |
| `path-security.test.js:70,139`       | hosts tratado como Excel; podía rechazar por extensión sin probar la prohibición. Retirar ambos negativos vacuos.                                                            | createPathSecurity y políticas, consumidos por handlers.                                  | [path-security-policies](../tests/path-security-policies.test.js): isDenied y error específico Ruta no permitida. Sigue el caso de archivo válido fuera de raíces. `d597a873`, `2595dacd`.                                          |
| `path-security-policies.test.js:144` | Directorio de salida inicialmente null; retirar repetición.                                                                                                                  | consent store, compuesto por createPathSecurity.                                          | [path-security](../tests/path-security.test.js): default null, selección real y rechazo de archivo como directorio. `5b2bd89`.                                                                                                      |
| `media-task-pool.test.js:280`        | Prioridad interactive antes de normal; retirar repetición.                                                                                                                   | media-task-pool, usado por thumbnail, preview y video.                                    | [media-task-pool](../tests/media-task-pool.test.js): selected/thumbnail/metadata/background, más [admisión](../tests/media-task-admission.test.js) por singleton. `5b2bd89`.                                                        |
| `python.op-shared.test.js:18,28`     | Dos subprocesses sobre gte/lte privados; retirar archivo y su probe Python.                                                                                                  | op_shared, usado por filtros export/preview.                                              | [test_op_active_fixtures](../python/test_op_active_fixtures.py) y [op-active-parity](../tests/op-active-parity.test.js): cláusulas escapadas y límites antes/en/después con fixture externo. Original `84ca4ac`; keepers `5b2bd89`. |
| `python-test-wiring.test.js:32`      | 38 casos cuentan referencias textuales. Comentarios/referencias sin ejecución los satisfacen; archivos unittest pueden pasar sin aserción. Retirar tabla.                    | Runner Python y scripts npm/CI.                                                           | [python-test-wiring](../tests/python-test-wiring.test.js): delegación y discovery ejecutable; gate real de los 38 scripts. `5b2bd89`.                                                                                               |
| `test_font_cache_reset.py:20`        | Copia tres globals internos de reset; retirar función e invocación.                                                                                                          | fonts.reset_caches, llamado por process_jobs.                                             | [test_font_cache_reset](../python/test_font_cache_reset.py): cinco regresiones con fuentes instaladas/borradas, drawtext y rescan entre runs. `d707a2d`.                                                                            |
| `test_hw_failed_retry.py:35`         | Flag privado y replay manual de _process_one; retirar mock, función e invocación.                                                                                            | processor, llamado por CLI y job worker.                                                  | [test_hw_failed_retry](../python/test_hw_failed_retry.py): process_jobs conserva encoder GPU en retry y exige secuencia GPU/CPU/CPU, éxitos y cero fallos. `5b2bd89`, `d707a2d`.                                                    |
| `test_timed_crop_zoom.py:36`         | Grep del crop permanente y prohibición de split; retirar función e invocación.                                                                                               | filters.build_filter_complex, export y preview.                                           | [test_crop_pipeline](../python/test_crop_pipeline.py) verifica dimensiones/coordenadas con píxeles y [paridad](../python/test_logo_preview_export_parity.py) comprueba export. El caso timed permanece. `63b6b50`.                  |
| `test_letter_spacing.py:9`           | Solo presencia de letras y hair space desde helper privado; retirar función e invocación.                                                                                    | text_layout_helpers, usado por drawtext.                                                  | [python.ffmpeg-path](../tests/python.ffmpeg-path.test.js): build_drawtext con spacing=8/font_size=48 exige texto exacto y fallback. Casos de spacing negativo y alineación permanecen. `acdd679`.                                   |

## Soporte y pruebas desacopladas

- Se retiraron `renderFooterWithUpdatePrompt`, su JSX/import exclusivo y los
  mocks/fixtures locales de los escenarios borrados. Los fixtures y harnesses
  compartidos siguen teniendo consumidores.
- `tests/helpers/python.js` perdió los exports sin importadores
  `PY_CODE_PREFIX` y `PY_CODE_PREFIX_UTF8`; PY y hasPython quedaron privados.
  describeIfPython conserva su consumidor en test-environment.
- La deduplicación de una tarea **activa** sigue siendo un riesgo distinto de
  deduplicar mientras está en cola. Su test ahora exige resultados compartidos
  y que el callback duplicado no se ejecute, sin comparar identidad de Promise.
- Los propietarios y seams de producción conservan consumidores reales;
  ninguna eliminación justificó borrarlos.

## Retención y límites

Se conservaron las guardas independientes de IPC/preload, perfiles, defaults,
seguridad, PyInstaller, empaquetado/firma/release y paridad JS/Python y
preview/export. Los tests de runtime-dependencies siguen protegiendo paths
usables y la ruta packaged; las pruebas dev no sustituyen ese contrato.

El verificador Authenticode mockeado puede detectar que init sobrescriba el
verificador de la librería; no se eliminó por el retorno fijo del mock. Tampoco
se retiraron los greps de blur sin demostrar un keeper para ambas ramas UI.
Quedan como investigación el grep global restante de quit y el caso de stat
cache llamado disabled que elimina una variable cuyo default habilita la caché.

## Verificación

- Primera corrida focalizada: 31 de 32 archivos y 375 de 376 casos aprobaron.
  La consolidación del updater introdujo un fixture incorrecto: login abre
  automáticamente el modal y el clic lo cerraba. Se fijó authStatus a
  authenticated para ejercer el footer del editor. La repetición con updater,
  footer, auth boot y app-update-check aprobó cuatro archivos y 17 casos.
  Comando de repetición: `node node_modules/vitest/vitest.mjs run
tests/updater-flow.test.jsx tests/status-footer.test.jsx
tests/auth-boot-gate.test.jsx tests/app-update-check.test.jsx`.
- Python focalizado: los siete scripts de fuentes, retry HW, límites temporales,
  crop, paridad, spacing y timed crop aprobaron, usando el runtime del proyecto
  y un entorno temporal propio.
- Tres controles mutan el módulo transformado **en memoria**, sin escribir
  fuentes: retirar deduplicación activa, cambiar la clave de sesión y permitir
  texto vacío ponen rojo el keeper por sus aserciones. Envolver la Promise
  conservando sus resultados mantiene verde el test de deduplicación.
- Tres revisiones independientes compararon borrados y keepers contra el
  snapshot; no encontraron contratos perdidos. Los archivos con cambios
  preexistentes se preservaron.
- Gate final: `npm run verify`, exit 0 y `verify: all gates passed`; lint y
  formato aprobados, 179 archivos Vitest con 1.212 casos aprobados y los 38
  scripts Python aprobados. `git diff --check` aprobó; los 28 enlaces relativos
  del informe resuelven. Tras actualizar este resultado se repitió la
  comprobación de formato, sin cambiar tests ni comportamiento.

## Líneas atribuibles a esta poda

`git diff --numstat` sobre los 21 archivos limpios inicialmente permite separar
este trabajo de los cambios ajenos. Las líneas incluyen blancos y comentarios.

| Superficie       | Archivos antes/después | Líneas antes | Líneas después |
| ---------------- | ---------------------: | -----------: | -------------: |
| Tests JS/JSX     |              180 / 179 |       25.614 |         25.244 |
| Tests Python     |                38 / 38 |        5.173 |          5.109 |
| Soporte de tests |                  8 / 8 |          445 |            441 |

| Categoría                 | Añadidas | Retiradas | Saldo |
| ------------------------- | -------: | --------: | ----: |
| Tests JS/JSX y Python     |       56 |       490 |  -434 |
| Soporte en tests/helpers  |        2 |         6 |    -4 |
| Producción y herramientas |        0 |         0 |     0 |

Documentación se cuenta aparte. No se hicieron stage, commits, push ni acciones
remotas. El conteo de líneas informa el alcance; la evidencia de confianza son
los contratos conservados, las revisiones y los resultados ejecutados.
