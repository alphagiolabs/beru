# Auditoría del ciclo de vida de FFmpeg

Fecha: 2026-10-09. Plataforma verificada: Windows. Alcance: exportación por lotes,
preview, sondeo, miniaturas, cancelación, cierre y ejecutable Python empaquetado.

La política aplicada es que un fallo de un Job permite continuar los demás Jobs;
el Run termina con fallo si conserva un Job fallido, cancelado o sin confirmar.
Solo una salida confirmada, existente, regular y no vacía se publica como exitosa.
Las salidas anteriores se conservan cuando falla la exportación temporal.

## Causas corregidas

| Causa                                                                                                                     | Corrección                                                                                                                                                                                                                      | Evidencia principal                                                               |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| La muerte abrupta de Electron, del worker o del lanzador de PyInstaller podía dejar FFmpeg vivo.                          | Un Job Object de Windows posee los descendientes y los mata al cerrar su último handle. El worker vigila tanto su padre inmediato como `BERU_PARENT_PID`. Sondeo y miniaturas usan el mismo propietario mediante `--run-media`. | `python/test_process_lifetime.py`, `tests/media-process-ownership.test.js`        |
| Una excepción en el lector de progreso o en el monitor temporal podía quedar dentro de un thread y bloquear las tuberías. | El error vuelve al hilo que coordina el Job; se terminan y esperan los procesos y se conserva el motivo del fallo.                                                                                                              | `python/test_ffmpeg_lifecycle.py`                                                 |
| Los warnings repetidos impedían detectar un bloqueo; avances menores al 1 % podían dejar al worker sin eventos.           | El bloqueo depende del avance de frames o tiempo, con límite de 120 s. Se emite progreso aproximadamente cada segundo, aun sin duración conocida. Copia y remux también emiten actividad.                                       | `python/test_ffmpeg_lifecycle.py`, `tests/job-worker.test.js`                     |
| Una línea de stderr sin saltos podía crecer sin límite.                                                                   | Lecturas de 4.096 caracteres y acumulación limitada a 48.000 caracteres.                                                                                                                                                        | `python/test_ffmpeg_lifecycle.py`                                                 |
| Exit 0, un `run_end` incompleto o la muerte inesperada del worker podían aceptarse como éxito.                            | Se exige confirmación de cada Job, salida válida y `run_end` con id correcto y `ok` booleano. Una muerte inesperada falla incluso con código 0.                                                                                 | `tests/process-handler-run.test.js`, `tests/job-worker.test.js`                   |
| El worker y la CLI devolvían éxito después de fallos o cancelaciones.                                                     | `run_end.ok` refleja el resultado del lote. La CLI termina con 0 al completar, 1 ante fallo y 130 ante cancelación. Se conserva el código de FFmpeg en el diagnóstico.                                                          | `python/test_ffmpeg_lifecycle.py`, `python/test_processor_context.py`             |
| El resumen podía omitir Jobs que nunca confirmaron su resultado o contar una promoción fallida como éxito.                | El resumen final se calcula desde los resultados confirmados por Main, después de cerrar los Jobs pendientes.                                                                                                                   | `tests/process-handler-run.test.js`                                               |
| Timeout o exceso de salida liberaban la capacidad antes de cerrar el proceso.                                             | Se solicita la terminación y se espera `close`; se escala al árbol si no cierra. Un cierre no confirmado se devuelve como error explícito.                                                                                      | `tests/run-captured-cancel.test.js`, `tests/video-probe-output-limit.test.js`     |
| Una cancelación fallida podía devolver éxito y liberar el Run aunque el worker siguiera vivo.                             | Se confirma el cierre antes de liberar la propiedad. Si no puede confirmarse, la cancelación devuelve fallo y el Run sigue bajo control. `taskkill` tiene timeout de 5 s.                                                       | `tests/process-handler-run.test.js`, `tests/main-fatal-kill-process-tree.test.js` |
| Un Job podía adquirir un slot de software después de cancelar el lote.                                                    | La cancelación se vuelve a comprobar bajo el lock de admisión.                                                                                                                                                                  | `python/test_processor_context.py`                                                |
| FFmpeg podía esperar entrada interactiva o tolerar errores de decodificación durante una exportación.                     | `stdin` deshabilitado y `-nostdin`; exportación y preview usan `-xerror`.                                                                                                                                                       | Pruebas reales de exportación, preview y del propietario empaquetado              |

El worker tiene un límite de 5 minutos sin eventos del protocolo y puede iniciarse
de nuevo tras morir. Los errores de protocolo, escritura, lectores y terminación
se registran o se devuelven al consumidor; el renderer tampoco convierte un fallo
confirmado de Job ni un cierre por señal en éxito.

## Fallos simulados y resultado

- Proceso real que sale con código 9 sin stderr y deja una salida parcial: Job
  fallido, código conservado y parcial retirado; el siguiente Job sano se completa.
- Exit 0 sin archivo o con archivo vacío: ningún evento `complete` aceptado y
  resumen final con un fallo.
- Excepción del lector de progreso y excepción del monitor de disco temporal:
  error visible y procesos terminados, sin esperar indefinidamente en las tuberías.
- Warnings repetidos y tiempo que no avanza: bloqueo detectado. Tiempo que avanza
  sin cambiar un punto porcentual: actividad visible y worker conservado.
- Dos megabytes de stderr sin salto de línea: captura acotada.
- `run_end` de otra solicitud, sin id o sin `ok`: no produce éxito del Run actual.
- Worker vivo que deja de responder: terminación con error y siguiente worker
  utilizable. Un worker lento con progreso sigue trabajando.
- Cancelación durante admisión o reintento, cancelaciones concurrentes y cierre
  que no se confirma: resultado y propiedad del proceso coherentes.
- Muerte de propietario, worker o lanzador: comprobación con handles reales de
  Windows de que terminan los descendientes. El caso del lanzador también se
  ejecutó con `bin/beru-processor.exe` reconstruido.
- Propietario empaquetado con fallo del hijo: stdin cerrado, stdout y stderr
  conservados y código 7 transmitido sin convertirse en éxito.

Antes de corregir el runner, las primeras reproducciones de su ciclo de vida
detectaron ocho fallos. La reproducción final del resumen detectó dos casos con
`failed: 0` para un Job sin confirmar; después del arreglo ambos cuentan un fallo.
Los logs locales de reproducción y cierre están en `.tmp/ffmpeg-*.log`.

## Verificación

- Gate completo anterior (`npm run verify`, antes del último ajuste del resumen):
  lint, formato, 179 archivos / 1.266 pruebas JavaScript y 37 archivos de pruebas
  Python aprobados.
- Repetición intermedia (`npm run verify`): lint y formato aprobados; JavaScript
  terminó con **178 archivos aprobados / 2 fallidos**, **1.267 pruebas aprobadas /
  2 fallidas**. Los **38 archivos Python** pasaron. Los dos fallos se detallan
  abajo y ya no aparecieron en la siguiente repetición.
- Última repetición (`npm run verify`): lint, **180 archivos / 1.269 pruebas
  JavaScript** y **38 archivos Python** aprobados. El formato global falla en
  `scripts/performance/compare-job-audits.mjs`, fuera del alcance de esta auditoría.
  El gate agregado conserva `verify: FAILED`; no se declara verde.
- `npm run build:processor`: ejecutable reconstruido y módulos empaquetados
  verificados, incluido `process_lifetime`.
- Pruebas Windows del propietario: tres métodos aprobados, incluyendo el
  ejecutable empaquetado; no hubo skips en esta ejecución local.
- Verificación focalizada del cierre y resumen: 56 pruebas aprobadas en tres
  archivos JavaScript.
- Repetición aislada de `tests/drop-file-paths.test.jsx`: tres pruebas aprobadas.
- `git diff --check`: sin errores de whitespace.
- Formato de los archivos JavaScript y Markdown del alcance: aprobado con
  `node node_modules/prettier/bin/prettier.cjs --check <archivos del alcance>`.

La primera ejecución de línea base falló en formato de scripts de rendimiento y
en `delogo-preview-frame-sync`; eran cambios existentes fuera de esta auditoría.
El gate completo posterior pasó. No se alteraron esos cambios para resolver este
trabajo. Los fallos introducidos inicialmente en las listas de módulos vigilados
se corrigieron incluyendo `process_lifetime` en build y desarrollo.

Los dos fallos de la repetición intermedia fueron:

1. `tests/drop-file-paths.test.jsx:58`: `Hook timed out in 10000ms` durante el
   `beforeEach`. El mismo archivo pasó después aislado. El archivo no se modificó;
   la duración e importación bajo carga son compatibles con un fallo intermitente
   de preparación, sin demostrar una regresión funcional de arrastre.
2. `tests/processor-child-env.test.js:11`: esperaba `OPENBLAS_NUM_THREADS === "1"`
   y recibió `undefined`. Este archivo apareció por una edición concurrente
   durante el gate. La función de producción tampoco definía ese default en
   HEAD; el cambio propio allí solo añade `BERU_PARENT_PID`. El default llegó
   posteriormente mediante el trabajo concurrente y el test pasó en la última
   repetición completa.

Medición del diff del alcance antes del cambio concurrente de OpenBLAS, contra
HEAD e incluyendo archivos nuevos:
producción/herramientas **+529 / -164** líneas y tests **+508 / -20** líneas.
Se excluyen documentación y archivos con ediciones ajenas compartidas, como
`python/test_processor_context.py`; allí el ajuste propio es la expectativa de
cancelación de `run_end.ok`. El saldo de líneas no es un indicador de cobertura.

Las pruebas nuevas verifican procesos, archivos o protocolos observables. No se
añadieron APIs de producción solo para tests. Se conservaron los reexports de
`processor.py`, los hiddenimports y los watchdogs que tienen consumidores reales.
Se consolidó la clasificación de Jobs pendientes al cerrar el Run y se reutilizó
la terminación común de FFmpeg en el pipeline temporal; no se podaron subsistemas
ajenos al ciclo de vida auditado.

La verificación comprende procesos reales, fault injection, límites IPC y el
procesador empaquetado. No incluye una instalación nueva con el instalador de
Electron ni una sesión manual completa de la UI. Las pruebas del ejecutable se
omiten si `bin/beru-processor.exe` no existe; para repetir esa comprobación hay que
construirlo primero. Si Windows rechaza la terminación, se devuelve un error y se
mantiene el control del Run; no se declara una cancelación exitosa.

La protección usa los contratos oficiales de Windows:
[límites de Job Object](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_basic_limit_information),
[límites extendidos](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_extended_limit_information)
y [asignación de procesos](https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-assignprocesstojobobject).
