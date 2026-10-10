# Auditoría de la suite — 2026-10-09

Se retiraron únicamente duplicaciones demostradas y una guarda de fuente cuyo
contrato se trasladó a una prueba ejecutable. No se retiró ninguna prueba por
fallar. Esta auditoría modifica tests y soporte; no modifica producción ni runners.

## Conexión y línea base

- Checkout inicial: `d707a2da60a6dc0226237481f9778174a65d0b11`, con cambios
  preexistentes. `main` local: `925c588ef0c2fa543deee84ef31f7aa7bf645439`.
- [Vitest](../vitest.config.js) incluye `tests/**/*.test.{js,jsx}`.
  `npm test` y `test:watch` comparten esa configuración.
- [El runner Python](../scripts/test-python.mjs) descubre y ordena todos los
  `python/test_*.py` del directorio raíz, y ejecuta cada script como proceso.
  Las funciones se invocan desde `main`, listas recorridas, `__main__` o
  `unittest.main`; no se encontró una función Python desconectada.
- [verify](../scripts/verify.mjs) ejecuta lint, formato, Vitest y Python.
  [CI Windows](../.github/workflows/ci-release.yml) ejecuta `npm run verify`; el
  job de release vuelve a ejecutar Python. Los scripts de regresión mantienen
  sus referencias a tests existentes.
- Los 214 archivos versionados de test iniciales coincidían con los patrones
  de sus runners: 178 JS/JSX y 36 Python. Los helpers, fixtures y harnesses son
  soporte importado, no suites abandonadas. No fue necesario cambiar discovery.
- Línea base ejecutada antes de editar: lint aprobado; formato falló en
  `scripts/performance/audit-jobs.mjs` y `compare-job-audits.mjs`, archivos
  ajenos sin seguimiento; Vitest aprobó 177 archivos y 1.252 tests, y falló un
  caso de `delogo-preview-frame-sync.test.jsx`; Python aprobó sus 36 scripts.
- Durante el trabajo aparecieron ediciones concurrentes en procesamiento,
  lifecycle de FFmpeg y sus tests. Se conservaron, incluidos cambios staged.
  Su saldo de líneas y sus nuevos escenarios no se atribuyen a esta auditoría.

## Eliminaciones y consolidaciones

Las líneas son las del test antes del cambio. El historial se consultó con
`git log`; cada keeper se contrastó con el dueño y sus consumidores reales.

| Test anterior                                  | Qué detectaba y decisión                                                             | Propietario y consumidores                                                            | Prueba conservada                                                                                                                                    | Historia y riesgo                                                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `tests/text-layout.test.js:23`                 | Más de una línea con texto/ancho/tamaño idénticos al fixture; retirar                | `text-layout.js`, usado por layout, fit y `TextOverlay`                               | [text-layout-contract](../tests/text-layout-contract.test.js), caso `long-wrap`, exige las seis líneas exactas                                       | Original `0ddcca18`, keeper `9bdfef6`. Se conserva por separado la prueba de defaults omitidos               |
| `tests/ui-audit-fixes.test.jsx:167`            | Cancelar el picker conserva path y versión; retirar el describe repetido y su import | `WatermarkModal` retorna al cancelar antes de escribir el store                       | [watermark-modal-consistency](../tests/watermark-modal-consistency.test.jsx), cancelación con ambas aserciones                                       | Keeper `63b6b50`, réplica `5b2bd89`, versiones actualizadas por `d707a2d`. Mismo camino visible              |
| `tests/export-pipeline-facade.test.js:107`     | Identidad del watermark tras `prepareRun`; retirar                                   | `export-run.js` y builder, consumidos por `processingSlice`                           | [export-run](../tests/export-run.test.js), watermark por identidad y perfil de encode                                                                | Migración y keeper `5b2bd89`; no hay rama del builder por el perfil que distinga esos inputs                 |
| `tests/petdex-handlers.test.js:155`            | Catálogo no vacío y boba; retirar                                                    | `readBundledCatalog`, usado por `fetchPetManifest`; la normalización no inventa slugs | [petdex-handlers](../tests/petdex-handlers.test.js), catálogo normalizado con boba y URLs; instalación y spritesheets permanecen                     | Original `f4c92ee7`, keeper `880d7bea`. No se eliminó ninguna guarda de recursos físicos                     |
| `tests/process-handler-run.test.js:353`        | Un fallo conserva el export previo y elimina staging; retirar                        | `processing-run` dispone cada salida staged, independientemente del número de jobs    | [process-handler-run](../tests/process-handler-run.test.js), fila `failure`: conserva el parcial previo, elimina staging y promueve solo el completo | Ambos `5b2bd89`; mismo error y mismo cleanup, sin rama exclusiva del caso individual                         |
| `tests/media-task-admission.test.js:153`       | Repite saturación con ocho bloqueadores y 2.000 trabajos; consolidar                 | Singleton `media-task-pool`, usado por procesamiento y handlers                       | [media-task-admission](../tests/media-task-admission.test.js), caso de overflow absorbe la readmisión después del drain                              | Ambos `5b2bd89`; se conserva la comprobación del límite por defecto, rechazo y recuperación                  |
| `tests/delogo-cover-ui.test.jsx:77`            | Repite picker exitoso, añadiendo stat/fingerprint; consolidar                        | `PropertiesPanel` escribe path y versión; preview consume la URL versionada           | [delogo-cover-ui](../tests/delogo-cover-ui.test.jsx), caso único conserva stat, path, fingerprint y limpieza de ambos                                | Original `dc4ebb3`, fingerprint `63b6b50`/`d707a2d`. Aserciones portadas antes de retirar el segundo caso    |
| `python/test_batch_summary_cancelled.py:10,15` | Grep de nombres y claves de cualquier retorno AST; retirar tras portar el contrato   | `process_jobs`, summary NDJSON e IPC; renderer consume los contadores                 | [test_processor_context](../python/test_processor_context.py), compara total/succeeded/failed/cancelled en run cancelado y run siguiente             | `71799d1` separó cancelados de fallos. Keeper verifica resultados reales `(1,0,0,1)` y `(1,1,0,0)`           |
| `python/test_watermark_empty_ops.py:47`        | Solo comprueba graph, drawtext y label presentes; retirar función y llamada          | `filters.py`, usado por export y preview                                              | [test_watermark_empty_ops](../python/test_watermark_empty_ops.py), FFmpeg real y píxeles en nueve posiciones sin operaciones; gate de copy permanece | Guarda `8119fcd`, keeper `06fa6d4`. El caso retirado no asertaba sus valores particulares de tamaño/opacidad |

## Pruebas reparadas y conservadas

- Updater: el harness ahora comienza con `autoDownload=true` y
  `autoInstallOnAppQuit=true`, defaults comprobados en la dependencia instalada.
  El test exige que `init` los desactive; antes el mock ya aportaba ambos valores.
- Invalidación de Python: el test mantiene la configuración, observa un probe
  para dos resoluciones y un segundo probe después de invalidar. Cambiar
  `BERU_PYTHON` antes del reset hacía que el guard de caché invalidase por otra razón.
  El seam sigue vivo en los clientes de job worker y preview.
- Builder plural: se introdujo un `null` en el caso existente que prometía
  filtrarlo, conservando los índices originales de los jobs válidos.
- GPU retry y límite de workers: los fixtures ahora llevan una operación de
  encode. Antes entraban en el pool de copy, cuyo límite independiente podía
  encubrir la regresión. Retry exige contextos con workers `[4,2]` y NVENC en
  ambas pasadas; el límite activo conserva ocho jobs terminados y máximo dos.
- Entrada CLI Python: el mock de resumen conserva las cuatro claves del
  contrato y permite verificar `SystemExit(0)`, incorporado por cambios concurrentes,
  sin perder la comprobación del encoder de preflight.
- Preview: se reinicia la instancia estática del worker entre fixtures. La ruta
  actual pinta blur/inpaint/temporal síncronamente durante reproducción; se
  comprueban dos frames presentados sin worker. El caso anterior leía mensajes
  de un worker residual. Su reemplazo crea trabajo pendiente desde pausa,
  inicia reproducción y verifica que la respuesta antigua no sobrescribe el
  frame nuevo. El timestamp del seek pausado sigue protegido.
- Sesión temporal: dos fixtures sin selección retornaban antes de crear historia.
  Ahora usan una selección válida y el mismo timestamp para exigir que un cambio
  de tamaño descarte el frame cacheado y que el reset deje pintar el primer frame
  de otro clip. Los nombres describen las aserciones observables; la reconstrucción
  con donantes sigue protegida por `delogo-motion.test.js`.

Cada reparación protege un contrato distinto con una regresión plausible;
modifica una prueba existente o amplía su tabla, sin añadir seams de producción.

## Retención y límites

Se conservaron las guardas independientes de IPC/preload, seguridad de rutas,
empaquetado, PyInstaller, firma/release, configuración, defaults, migración y
persistencia, además de paridad JS/Python y preview/export. No se consideran
duplicadas por ser estáticas o por compartir un helper con una interacción real.

Se mantienen como investigación, sin borrado:

- El conteo textual de referencias de `python-test-wiring.test.js` detecta
  funciones sin ninguna referencia, pero no demuestra que cada referencia se
  ejecute. La conexión actual se confirmó también leyendo los entrypoints.
- Algunas guardas de cierre/update y negativos de rutas merecen aserciones más
  precisas. No se retiraron sin un keeper equivalente.

## Verificación

Los controles de mutación se ejecutan sobre módulos transformados en memoria:
activar auto-install, activar auto-download, vaciar invalidación, quitar el filtro
de jobs, ignorar el token de frame, sumar cancelados a fallos, omitir el cambio de
dimensiones y vaciar el reset de sesión. Los ocho controles pusieron rojo el keeper
por una aserción; ninguna fuente se sobrescribió.

La primera ejecución focalizada aprobó 25 de 27 archivos y 290 de 298 casos.
Los fallos fueron escenarios de exportación agregados concurrentemente, tres
casos de lifecycle de runs y un mock CLI que se reparó después. Ese resultado
no se presenta como gate verde.

La primera corrida completa posterior aprobó lint, formato y los 37 scripts
Python. Vitest aprobó 178 de 179 archivos y 1.265 de 1.266 casos; falló
`preview-frame-seek.test.js:235` con `Test timed out in 60000ms`. Esa prueba no se
modificó ni se retiró. Su repetición aislada, `node node_modules/vitest/vitest.mjs run
tests/preview-frame-seek.test.js`, aprobó los ocho casos en 10,95 segundos con el
mismo límite. No se atribuye el timeout a una causa demostrada.

La última repetición de `npm run verify` terminó con exit 0 y
`verify: all gates passed`: lint y formato aprobados, 179 archivos JS/JSX y sus
1.266 casos aprobados, y los 37 scripts Python aprobados. Vitest terminó en 61,92
segundos. La conexión incluye los nuevos tests concurrentes de ownership de
procesos y lifecycle; sus casos no se atribuyen a esta poda.

`git diff --check` terminó con exit 0. Los 13 enlaces relativos del informe
resuelven a archivos existentes. Tras cerrar el informe se volvió a comprobar
su formato; no se modificó comportamiento después del gate verde.

## Líneas y atribución

Las líneas siguientes cuentan archivos de texto completos, incluidos comentarios
y blancos. La columna inicial usa el SHA indicado al principio; la columna actual
incluye cambios ajenos y nuevos archivos de otras tareas. El soporte contado aquí
son `tests/setup.js`, `tests/helpers/` y `tests/updater-main.harness.mjs`.

| Categoría                 |       Inicial en HEAD |                Actual | Añadidas por esta auditoría | Retiradas por esta auditoría |
| ------------------------- | --------------------: | --------------------: | --------------------------: | ---------------------------: |
| Tests JS/JSX              | 25.438 (178 archivos) | 25.595 (179 archivos) |                          81 |                          172 |
| Tests Python              |   4.901 (36 archivos) |   5.119 (37 archivos) |                           8 |                           61 |
| Soporte                   |      365 (6 archivos) |      365 (6 archivos) |                           2 |                            2 |
| Producción y herramientas |                     — |                     — |                           0 |                            0 |

El saldo propio es de 144 líneas menos entre tests y soporte. Es una descripción
del diff, no una métrica de cobertura. Las siete declaraciones JS consolidadas o
retiradas, las dos guardas del script Python eliminado y la función watermark
retirada tienen sus contratos en los keepers indicados. La tabla de playback
añade las dos rutas útiles de inpaint y temporal. No se hicieron commits ni push.
