# Implementación de optimizaciones por Job — 2026-10-09

Las rutas bajo `.audit-tmp/` identifican evidencias locales de la auditoría original, ignoradas por Git. Esos archivos no están disponibles en el checkout actual; las mediciones históricas de este informe no se han vuelto a comprobar en esta limpieza.

Se implementaron tres cambios en el worktree actual y se reconstruyó `bin/beru-processor.exe`. Se conservaron los cambios ajenos. El decoder mantiene su configuración: su límite quedó pendiente de validación con videos reales, conforme a la recomendación aceptada.

La verificación nueva comprende **246 exportaciones medidas y 132 comparaciones exactas** de todos los frames y del audio decodificado. No hubo cambios de fuentes Python durante las mediciones. Entre la línea base actual y la implementación solo cambió `ffmpeg_runner.py` entre los módulos Python de producción. Los 103 comandos completos del A/B de fuentes, los 18 de OpenBLAS en Python y los diez comandos finales de la prueba alternada coinciden al normalizar rutas de salida y temporales. Los comandos internos del ejecutable no se capturaron; su calidad se comprobó por salida y por paridad con las fuentes actuales.

## Cambios

- En `python/ffmpeg_runner.py`, el loop espera `proc.wait(timeout=0.2)` y captura `TimeoutExpired`. Conserva cancelación, timeout, detección de stall, lectura de stderr, retries y limpieza.
- La copia usa un `bytearray` y una `memoryview`, lee mediante `readinto` y escribe solo los bytes leídos. El buffer mide como máximo 8 MiB y se reduce al tamaño de archivos pequeños; un archivo vacío conserva el manejo de EOF.
- `buildProcessorChildEnv` asigna `OPENBLAS_NUM_THREADS=1` por defecto antes de crear el Processor. Respeta un valor explícito no vacío y no modifica el entorno del padre. El mismo constructor se usa para workers de Jobs y preview.

## Resultado medido

Las tablas muestran medianas de máximos observados por invocación. Privado es compromiso privado; RSS es working set residente. Se mantuvo un Job activo y un worker, sin cambiar concurrencia, resolución, filtros, perfiles ni parámetros del encode.

| Caso                                            |      Antes |   Después | Lectura del resultado                                |
| ----------------------------------------------- | ---------: | --------: | ---------------------------------------------------- |
| Remux: pared, A/B alternado                     |   211.5 ms |   67.7 ms | Cinco repeticiones por variante                      |
| Remux: salida del proceso → cierre del Job      |   142.1 ms |    3.9 ms | Efecto directo de la espera                          |
| Copia grande: pico privado del Processor Python |   33.4 MiB |  25.4 MiB | Evita mantener dos bloques de 8 MiB                  |
| Copia grande: pico privado de todo el árbol     |   34.6 MiB |  33.1 MiB | El ahorro del pico del Job completo es menor         |
| Inpaint en Python: pico privado del árbol       | 1023.0 MiB | 667.7 MiB | OpenBLAS, tres repeticiones                          |
| Inpaint empaquetado QSV: pico privado del árbol |  691.1 MiB | 338.9 MiB | Mismo ejecutable recién construido, entorno distinto |
| Inpaint empaquetado QSV: RSS del árbol          |  346.6 MiB | 345.3 MiB | No equivale a ahorrar 350 MiB de RAM residente       |

La copia grande tuvo pared mediana **1.528 → 2.298 s** en la tanda alternada. No demuestra aceleración de I/O: la variante nueva fue más lenta en esa tanda y los rangos fueron amplios. Se conserva por el ahorro privado del Processor y la integridad byte por byte de sus 16 archivos completos.

OpenBLAS en Python: temporal 2.657 → 2.653 s; inpaint 3.428 → 4.141 s. En el empaquetado: temporal 2.711 → 2.676 s; inpaint 3.595 → 3.541 s. La mejora se justifica por compromiso privado; no se afirma una aceleración general.

La carga y RAM libre variaron entre tandas. Por ejemplo, blur 4K software tuvo mediana de pared 3.424 → 14.664 s entre los bloques completos, con idénticos comandos y salida. La comparación alternada aisló la espera de terminación. Estas mediciones no permiten atribuir una mejora de throughput global a los cambios.

## Cada Job

CSV con las 246 invocaciones y muestras (`.audit-tmp/job-optimizations-20261009/per-job.csv`). En copia/remux muy breves, cero o una muestra no basta para describir el pico completo; el cero del CSV con cero muestras significa ausencia de observación. Se conservan los máximos individuales y datos brutos.

| Job                     | Antes: pared (s) | Después: pared (s) |  Antes: privado (MiB) | Después: privado (MiB) |
| ----------------------- | ---------------: | -----------------: | --------------------: | ---------------------: |
| 1080-copy               |            0.069 |              0.148 | muestreo insuficiente |  muestreo insuficiente |
| 1080-remux              |            0.210 |              0.155 |                  33.8 |                   40.9 |
| 1080-text               |            2.017 |              2.528 |                 648.0 |                  648.1 |
| 1080-blur               |            1.826 |              2.478 |                 645.7 |                  645.7 |
| 1080-crop               |            0.814 |              1.057 |                 379.6 |                  379.5 |
| 1080-watermark          |            2.230 |              2.031 |                 646.7 |                  646.8 |
| 1080-delogo             |            1.425 |              1.754 |                 647.4 |                  647.4 |
| 1080-mixed              |            2.051 |              3.199 |                 660.3 |                  660.5 |
| 1080-trim               |            0.816 |              1.165 |                 424.7 |                  445.2 |
| 4k-copy                 |            0.074 |              0.134 | muestreo insuficiente |                   55.4 |
| 4k-remux                |            0.211 |              0.242 |                  56.5 |                   38.3 |
| 4k-text                 |            6.376 |             13.003 |                2148.1 |                 2151.9 |
| 4k-blur                 |            3.424 |             14.664 |                2149.8 |                 2183.5 |
| 4k-crop                 |            1.825 |              3.798 |                1187.3 |                 1249.9 |
| 4k-watermark            |            5.657 |             10.622 |                2161.9 |                 2162.6 |
| 4k-delogo               |           17.025 |             16.755 |                2221.3 |                 2151.1 |
| 4k-mixed                |           12.397 |             10.377 |                2284.7 |                 2285.0 |
| 4k-trim                 |            5.287 |              4.469 |                1618.7 |                 1589.7 |
| 1080-blur-fast          |            2.379 |              1.878 |                 287.1 |                  287.0 |
| 1080-blur-quality       |            3.939 |              3.369 |                 744.6 |                  744.5 |
| 1080-blur-uquality      |            1.835 |              1.590 |                 593.3 |                  593.4 |
| 4k-blur-qsv             |            2.416 |              3.856 |                 867.5 |                  868.0 |
| 1080-hevc10-blur        |            1.616 |              5.189 |                1001.3 |                 1029.5 |
| 1080-vp9-blur           |            1.011 |              2.088 |                 539.1 |                  581.5 |
| copy-256MiB             |            0.494 |              2.038 |                  35.1 |                   32.9 |
| 1080-temporal           |            3.280 |              9.043 |                1020.4 |                 1020.7 |
| 1080-inpaint            |            4.340 |              4.887 |                1020.8 |                 1020.8 |
| 1080-temporal-qsv       |            3.148 |              2.900 |                 695.3 |                  692.4 |
| 1080-inpaint-qsv        |            4.927 |             11.357 |                 697.0 |                  697.9 |
| 1080-copy-after-patches |            0.101 |              0.205 | muestreo insuficiente |  muestreo insuficiente |

Esta tabla compara espera/buffer con OpenBLAS sin override en ambas tandas. Su efecto de memoria se midió después, en procesos nuevos separados. Son fixtures sintéticos de H.264 1080p/4K, HEVC 10 bits y VP9; QSV real fue utilizado en los seis Jobs de parches de cada tanda empaquetada. NVENC, AMF, MF y Electron no se midieron en esta implementación.

## Pruebas y evidencia

La [verificación ampliada con video real, concurrencia y sesión persistente](job-verification-2026-10-10.md) complementa estas mediciones sintéticas y registra sus límites y los cuellos de botella pendientes.

- `npm run build:processor`: correcto; binario local reconstruido. La copia del ejecutable anterior se conservó en `.audit-tmp/job-optimizations-20261009/before-source/beru-processor.exe`. El binario nuevo incluye el worktree actual, con los cambios ajenos preexistentes.
- `npm run lint`: correcto.
- `npm test`: 1269 pruebas correctas en 180 archivos.
- `npm run test:python`: 38 archivos correctos.
- `npm run format:check`: correcto tras formatear el comparador y este informe.

Los tests nuevos protegen bytes, bloque final parcial, EOF, cancelación entre bloques sin emitir completado y el contrato de entorno del Processor. Las pruebas de copia pasaban en la línea base y se conservaron como guardas; la de default OpenBLAS falló antes por el valor ausente y pasó después. Se reutilizaron las pruebas reales existentes de cancelación, errores, deadline, stderr y ciclo de vida. No se agregaron exports, flags ni wrappers de producción para tests.

Diff exclusivo de esta implementación (`.audit-tmp/job-optimizations-20261009/implementation.diff`), línea base (`.audit-tmp/job-optimizations-20261009/before/report.json`), espera y buffer (`.audit-tmp/job-optimizations-20261009/copy-wait-comparison.json`), A/B alternado (`.audit-tmp/job-optimizations-20261009/interleaved/report.json`), comandos alternados (`.audit-tmp/job-optimizations-20261009/interleaved-command-invariants.json`), copias completas (`.audit-tmp/job-optimizations-20261009/copy-byte-equality.json`), OpenBLAS en Python (`.audit-tmp/job-optimizations-20261009/blas-comparison.json`), OpenBLAS empaquetado (`.audit-tmp/job-optimizations-20261009/packaged-comparison.json`), paridad fuente/binario (`.audit-tmp/job-optimizations-20261009/source-packaged-comparison.json`), resumen (`.audit-tmp/job-optimizations-20261009/summary.json`).

Lint (`.audit-tmp/job-optimizations-20261009/verification/lint.log`), formato (`.audit-tmp/job-optimizations-20261009/verification/format.log`), JavaScript (`.audit-tmp/job-optimizations-20261009/verification/test.log`), Python (`.audit-tmp/job-optimizations-20261009/verification/python.log`), build (`.audit-tmp/job-optimizations-20261009/verification/build-processor.log`), test de entorno antes (`.audit-tmp/job-optimizations-20261009/verification/env-before.log`), test de entorno después (`.audit-tmp/job-optimizations-20261009/verification/env-after.log`).
