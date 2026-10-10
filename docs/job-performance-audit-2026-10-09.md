# Rendimiento y memoria por Job — 2026-10-09

Las rutas bajo `.audit-tmp/` identifican evidencias locales de la auditoría original, ignoradas por Git. Esos archivos no están disponibles en el checkout actual; las mediciones históricas de este informe no se han vuelto a comprobar en esta limpieza.

## Resultado y alcance

La [implementación posterior y su nueva verificación A/B](job-optimizations-2026-10-09.md) documenta los tres cambios incorporados después de esta auditoría. Las cifras y el estado descritos aquí corresponden a la investigación original.

Se midieron **352 exportaciones**, 12 ejecuciones de diagnóstico sin encode final y seis capturas adicionales de cProfile. Hay **197 comparaciones antes/después**, todas con video y audio decodificados idénticos. En 174 comparaciones de exportaciones con FFmpeg se verificó también que los argumentos de filtros y encode permanecieran iguales, normalizando únicamente las rutas temporales/de salida y el cambio experimental de hilos de entrada. Diez copias nativas preservaron el archivo completo byte por byte.

El mayor pico privado observado fue **2199.2 MiB** en una invocación de `4k-mixed` balanced por software; su pico RSS fue **1711.2 MiB**. Los tiempos y máximos de cada ejecución están en el CSV, además de las medianas de las tablas.

Se recomienda evaluar cuatro cambios acotados: esperar la terminación de FFmpeg mediante su handle, reutilizar el buffer de copia, limitar OpenBLAS a un hilo y limitar los hilos del decoder según codec y presión de memoria. Esta auditoría no aplicó ninguno al procesador de producción. Los cambios ajenos se conservaron.

Las mediciones corresponden a las fuentes capturadas por los informes, con HEAD `d707a2da60a6dc0226237481f9778174a65d0b11`; HEAD por sí solo no identifica los cambios sin commit. Las once series registraron el mismo SHA-256 de `processor.py`: `a185bf7f830a9e9744b1e976225a5e082eaf796b330f7f2c18c50f4fba11d6f7`. Durante el cierre aparecieron cambios ajenos en `processor.py`, `ffmpeg_runner.py` y `temporal_pipeline.py`, entre otros archivos. **No se consideran medidas ni validadas esas modificaciones posteriores.** Los JSON conservan el SHA-256 de `processor.py` y de los binarios por serie; la evidencia de cierre registra esos hashes frente a las fuentes actuales. FFmpeg y el ejecutable empaquetado seguían coincidiendo con sus hashes medidos al cierre. El instrumento inicial no guardó todos los módulos Python, por lo que tampoco permite certificar retrospectivamente que cada dependencia permaneció idéntica entre series. El runner final registra hashes de todos los módulos Python de producción al inicio y al final y rechaza una corrida de desarrollo si cambian.

Son fixtures sintéticos, no videos del usuario. Los resultados describen este equipo y estas operaciones; no son una garantía universal de velocidad. Electron no pudo medirse: el arnés original falló dos veces antes de iniciar y el propio `electron.exe --version` terminó con `2147483651` (`0x80000003`), sin diagnóstico útil en stderr. No se atribuye a Electron ninguna cifra del árbol Python/FFmpeg.

## Método y límites de medición

- Windows 11, Intel i5-12400, 12 procesadores lógicos, 8 GB de RAM; memoria disponible variable durante los ensayos. Node 22.13.0, Python 3.14.8, NumPy 2.4.6 y FFmpeg 9.0.2 del repositorio. También se ejecutó `bin/beru-processor.exe`, usando su detección real de hardware y un worker por run.
- Un Job activo por vez. Contexto con un worker, filtros con cuatro hilos y libx264 con ocho hilos. QSV conserva `-global_quality 23`. Los perfiles y sus parámetros se mantienen dentro de cada pareja A/B. No se extrapolan estos valores a lotes concurrentes: cambiar la concurrencia también cambia los hilos de libx264 en el código actual.
- 1080p, 4 s, 24 fps; 4K, 2 s, 24 fps; audio AAC mono a 48 kHz. HEVC 10 bits y VP9: 1080p, 2 s. Copia grande: MP4 válido con un átomo `free` adicional de 256 MiB, sin cambiar sus frames. La matriz incluye copia, remux, texto, blur, crop, watermark de imagen, delogo, mezcla, trim, temporal e inpaint.
- Tres repeticiones por variante, alternando el orden A/B. La copia grande tiene cinco. Las tablas muestran la mediana del tiempo y la mediana de los máximos por ejecución. El CSV conserva **cada invocación**, incluyendo outliers y máximos individuales.
- Se reutilizó `sample-memory.ps1` del repositorio, configurado a 50 ms. En la serie principal, los intervalos máximos efectivos por Job fueron de 64 a 135 ms. La suma simultánea del árbol completo incluye launcher, Python/processor, conhost, ffprobe y todos los FFmpeg. Es un **pico observado**, un límite inferior del pico real; no una suma de máximos de procesos ocurridos en momentos distintos.
- Las copias y remux muy breves pueden escapar al muestreo. Se marcan como insuficientes, nunca como cero memoria. Los ensayos posteriores registran además `GetProcessMemoryInfo` sobre handles conservados de los hijos, después de su terminación: el pico de cada FFmpeg procede del contador del SO y no depende del intervalo del sampler. Ese contador individual no equivale al pico simultáneo del árbol completo.
- Memoria privada significa compromiso privado; RSS significa working set residente. El ahorro de OpenBLAS es fundamentalmente de compromiso privado, no de RAM residente. La suma RSS del árbol puede contar páginas compartidas varias veces; no es PSS ni VRAM. Las definiciones proceden de [Microsoft](https://learn.microsoft.com/en-us/windows/win32/api/psapi/ns-psapi-process_memory_counters_ex).
- `framemd5` compara todos los frames en el formato de píxel de salida y audio PCM float32, incluyendo tiempos, dimensiones y SAR. Se comparan los archivos de fingerprints completos. No se usa una tolerancia perceptual que pueda ocultar diferencias. QSV fue verificado con exportaciones reales; NVENC, AMF y MF no se midieron.
- El primer Job puede pagar inicialización de fonts, detección o NumPy. La serie principal fuerza `frame_rate=0`, lo que añade un probe en temporal/inpaint; las confirmaciones usan el frame rate real del manifest. No se presenta eliminar ese probe como mejora: la aplicación ya transporta `frame_rate`.
- Las primeras corridas interrumpidas/incorrectas y el intento empaquetado sin directorio temporal escribible se excluyen. Se corrigió una importación anticipada de NumPy introducida por el instrumento antes de la serie válida `results-v3`. Los informes Electron comprueban que sus fuentes no cambiaron durante la ejecución.

## Serie principal: libx264 balanced

| Job            | Variante | Tiempo mediano (s) | Pico privado mediano (MiB) | Pico RSS mediano (MiB) |
| -------------- | -------- | -----------------: | -------------------------: | ---------------------: |
| 1080-copy      | baseline |              0.040 |      muestreo insuficiente |  muestreo insuficiente |
| 1080-remux     | baseline |              0.207 |                       32.0 |                   41.2 |
| 1080-text      | baseline |              1.452 |                      645.7 |                  583.7 |
| 1080-text      | decode2  |              1.410 |                      577.3 |                  519.2 |
| 1080-blur      | baseline |              1.211 |                      643.4 |                  580.1 |
| 1080-blur      | decode2  |              1.217 |                      572.2 |                  512.7 |
| 1080-crop      | baseline |              0.607 |                      377.2 |                  354.7 |
| 1080-crop      | decode2  |              0.610 |                      305.9 |                  287.2 |
| 1080-watermark | baseline |              1.211 |                      644.4 |                  582.1 |
| 1080-watermark | decode2  |              1.213 |                      579.3 |                  520.6 |
| 1080-delogo    | baseline |              1.211 |                      645.1 |                  582.2 |
| 1080-delogo    | decode2  |              1.209 |                      573.9 |                  514.6 |
| 1080-mixed     | baseline |              1.409 |                      657.9 |                  594.6 |
| 1080-mixed     | decode2  |              1.212 |                      586.6 |                  528.4 |
| 1080-trim      | baseline |              0.610 |                      412.8 |                  343.4 |
| 1080-trim      | decode2  |              0.607 |                      409.7 |                  337.3 |
| 4k-copy        | baseline |              0.062 |      muestreo insuficiente |  muestreo insuficiente |
| 4k-remux       | baseline |              0.206 |                       38.6 |                   52.1 |
| 4k-text        | baseline |              2.611 |                     2145.6 |                 1673.3 |
| 4k-text        | decode2  |              2.612 |                     1904.2 |                 1550.3 |
| 4k-blur        | baseline |              2.613 |                     2147.9 |                 1677.8 |
| 4k-blur        | decode2  |              2.613 |                     1903.0 |                 1551.0 |
| 4k-crop        | baseline |              1.412 |                     1185.3 |                  929.1 |
| 4k-crop        | decode2  |              1.411 |                      933.6 |                  794.9 |
| 4k-watermark   | baseline |              2.614 |                     2159.9 |                 1687.8 |
| 4k-watermark   | decode2  |              2.414 |                     1891.9 |                 1539.6 |
| 4k-delogo      | baseline |              2.616 |                     2148.6 |                 1672.8 |
| 4k-delogo      | decode2  |              2.415 |                     1904.0 |                 1540.3 |
| 4k-mixed       | baseline |              2.617 |                     2199.1 |                 1685.5 |
| 4k-mixed       | decode2  |              2.814 |                     1938.0 |                 1533.3 |
| 4k-trim        | baseline |              2.011 |                     1490.7 |                 1070.4 |
| 4k-trim        | decode2  |              2.016 |                     1447.1 |                 1069.9 |
| 1080-temporal  | baseline |              3.334 |                     1019.4 |                  591.9 |
| 1080-temporal  | decode2  |              3.070 |                      947.7 |                  524.6 |
| 1080-inpaint   | baseline |              4.068 |                     1018.7 |                  588.7 |
| 1080-inpaint   | decode2  |              4.244 |                      948.3 |                  522.2 |

`decode2` añade `-threads 2` **antes** del primer `-i`; los hilos del encoder siguen siendo ocho. Esta distinción de opciones de entrada/salida está documentada por [FFmpeg](https://www.ffmpeg.org/ffmpeg.html). `crop` conserva las dimensiones del recorte ya definido por el Job en ambos lados de la comparación.

## QSV: camino usable en este equipo

| Job                | Variante | Tiempo mediano (s) | Pico privado mediano (MiB) | Pico RSS mediano (MiB) |
| ------------------ | -------- | -----------------: | -------------------------: | ---------------------: |
| 1080-text-qsv      | baseline |              1.011 |                      315.0 |                  305.4 |
| 1080-text-qsv      | decode2  |              1.010 |                      243.1 |                  237.6 |
| 1080-blur-qsv      | baseline |              1.214 |                      315.3 |                  304.5 |
| 1080-blur-qsv      | decode2  |              1.009 |                      244.1 |                  237.6 |
| 1080-crop-qsv      | baseline |              0.808 |                      269.5 |                  264.7 |
| 1080-crop-qsv      | decode2  |              0.809 |                      188.4 |                  189.0 |
| 1080-watermark-qsv | baseline |              1.010 |                      317.2 |                  306.9 |
| 1080-watermark-qsv | decode2  |              1.208 |                      245.0 |                  238.8 |
| 1080-mixed-qsv     | baseline |              1.210 |                      330.7 |                  320.9 |
| 1080-mixed-qsv     | decode2  |              1.209 |                      259.2 |                  253.7 |
| 4k-text-qsv        | baseline |              1.816 |                      862.3 |                  799.8 |
| 4k-text-qsv        | decode2  |              1.815 |                      603.3 |                  552.2 |
| 4k-blur-qsv        | baseline |              2.017 |                      864.4 |                  796.5 |
| 4k-blur-qsv        | decode2  |              1.809 |                      605.6 |                  548.9 |
| 4k-crop-qsv        | baseline |              1.210 |                      668.3 |                  631.2 |
| 4k-crop-qsv        | decode2  |              1.210 |                      368.8 |                  348.9 |
| 4k-watermark-qsv   | baseline |              1.816 |                      864.2 |                  796.5 |
| 4k-watermark-qsv   | decode2  |              1.612 |                      605.1 |                  548.7 |
| 4k-mixed-qsv       | baseline |              1.816 |                      916.1 |                  847.5 |
| 4k-mixed-qsv       | decode2  |              1.813 |                      656.7 |                  600.0 |
| 1080-temporal-qsv  | baseline |              2.555 |                      692.3 |                  325.3 |
| 1080-temporal-qsv  | decode2  |              2.593 |                      616.6 |                  254.8 |
| 1080-inpaint-qsv   | baseline |              3.591 |                      693.4 |                  325.8 |
| 1080-inpaint-qsv   | decode2  |              3.237 |                      616.7 |                  255.5 |

Las 36 comparaciones QSV fueron exactas. En watermark 1080p, el tiempo mediano subió de 1.010 a 1.208 s aunque bajó la memoria. Se debe decidir el límite por objetivo de memoria y confirmar la latencia del workload; no hay evidencia de una aceleración global.

## Perfiles y codecs adicionales

| Job                | Variante | Tiempo mediano (s) | Pico privado mediano (MiB) | Pico RSS mediano (MiB) |
| ------------------ | -------- | -----------------: | -------------------------: | ---------------------: |
| 1080-blur          | baseline |              1.417 |                      644.1 |                  579.9 |
| 1080-blur          | decode2  |              1.410 |                      572.8 |                  512.9 |
| 4k-blur            | baseline |              3.214 |                     2148.3 |                 1675.1 |
| 4k-blur            | decode2  |              3.014 |                     1903.1 |                 1550.7 |
| 1080-text          | baseline |              1.214 |                      646.6 |                  576.5 |
| 1080-text          | decode2  |              1.213 |                      575.3 |                  509.7 |
| 1080-blur-fast     | baseline |              0.610 |                      286.0 |                  260.6 |
| 1080-blur-fast     | decode2  |              0.609 |                      208.6 |                  187.5 |
| 1080-blur-quality  | baseline |              1.608 |                      743.2 |                  639.9 |
| 1080-blur-quality  | decode2  |              1.408 |                      671.9 |                  572.6 |
| 1080-blur-uquality | baseline |              1.008 |                      590.5 |                  511.4 |
| 1080-blur-uquality | decode2  |              1.010 |                      519.2 |                  444.3 |

| Job              | Variante | Tiempo mediano (s) | Pico privado mediano (MiB) | Pico RSS mediano (MiB) |
| ---------------- | -------- | -----------------: | -------------------------: | ---------------------: |
| 1080-hevc10-blur | baseline |              2.015 |                      973.8 |                  823.8 |
| 1080-hevc10-blur | decode2  |              2.461 |                      903.6 |                  822.1 |
| 1080-vp9-blur    | baseline |              1.012 |                      550.2 |                  467.4 |
| 1080-vp9-blur    | decode2  |              0.808 |                      533.2 |                  466.6 |

Las 24 comparaciones de estas dos series fueron exactas. HEVC 10 bits pasó de 2.015 a 2.461 s de mediana, con rangos amplios: no se recomienda imponer dos hilos de decoder universalmente. VP9 ahorró apenas 17 MiB, frente a unos 71 MiB en H.264 1080p. Mantener el codec y el workload como condiciones de la decisión.

## Cuellos de botella medidos

El tramo FFmpeg domina los Jobs sin parches: la CPU de Python fue habitualmente 0–0.031 s por Job. En la confirmación de blur 1080p, FFmpeg consumió varios segundos de CPU agregada por unos 1.4 s de pared. No hay evidencia para optimizar la construcción ordinaria de objetos u operaciones antes que el encode.

Diagnósticos a `null`, sin producir una exportación, mantuvieron fuente y, para `filters-only`, el grafo y formato de salida. Sirven para ubicar trabajo; no son variantes de calidad ni sus tiempos se suman como fases independientes:

| Diagnóstico blur      | Pared mediana (s) | CPU de hijos mediana (s) | Pico individual FFmpeg (MiB de commit) |
| --------------------- | ----------------: | -----------------------: | -------------------------------------: |
| 1080p decode-only     |             0.207 |                    0.875 |                                  125.0 |
| 1080p filters-only    |             0.406 |                    0.875 |                                  131.3 |
| 4K decode-only        |             0.606 |                    2.094 |                                  407.2 |
| 4K filters-only       |             1.011 |                    2.578 |                                  443.7 |
| 1080p export balanced |             1.417 |                 ver JSON |                                  626.3 |
| 4K export balanced    |             3.214 |                 ver JSON |                                 2130.6 |

El incremento más grande de memoria aparece al añadir el encode. Los buffers del encoder no se redujeron porque se pidió preservar sus parámetros. Los parches son otra fase real: preparan un MKV FFV1 lossless con dos FFmpeg y NumPy, y después ejecutan el encode final. cProfile identifica `_motion`/`score` en temporal y `reconstruct_texture`/`score_offsets` en inpaint. Sus tiempos acumulados pueden solaparse entre threads; no se suman ni se interpretan como porcentajes de pared.

La estimación estática de capacidad no es una medición. Para 4K balanced con filtros, el modelo software da 1920 MiB y el modelo QSV 720 MiB; los picos observados del Job mixed fueron aproximadamente 2199 y 916 MiB. El modelo no describe además toda la memoria compartida retenida por NumPy. Esto requiere calibración futura, pero no se recomienda cambiar la concurrencia sin otro A/B: actualmente también modificaría los hilos del encode.

## Propuestas respaldadas por A/B

### 1. Esperar la salida de FFmpeg

En `python/ffmpeg_runner.py`, sustituir únicamente `time.sleep(0.2)` del loop por `proc.wait(timeout=0.2)` con `TimeoutExpired` capturado. Conservar cancelación, deadlines, stall, stderr y retries.

Remux: **0.205 → 0.046 s** de mediana; el retraso entre salida real del proceso y cierre del Job bajó de aproximadamente **165 → 2.8 ms**. Blur: **1.609 → 1.270 s**, pero la CPU y carga externa también variaron. La reducción del retraso de notificación es la evidencia causal más clara; no implica acelerar el encode. Seis comparaciones de video/audio y seis comandos finales iguales.

### 2. Reutilizar el buffer de copia nativa

En `_native_stream_copy`, crear un `bytearray` de 8 MiB y una `memoryview` por Job, usar `readinto` y escribir solamente los bytes leídos. Conservar el chequeo de cancelación en cada iteración. El loop actual puede mantener el bloque anterior mientras se asigna el siguiente.

Copia grande, cinco repeticiones: **34.0 → 26.0 MiB** de pico privado observado y **50.3 → 42.3 MiB** RSS. Pared mediana **0.522 → 0.343 s**, con outliers de I/O muy grandes en baseline; no se promete ese porcentaje de throughput. Diez archivos completos, de ambas variantes, tienen el mismo SHA-256 que la entrada; las cinco comparaciones multimedia también fueron exactas.

### 3. Un hilo OpenBLAS en el entorno del Processor

Asignar `OPENBLAS_NUM_THREADS=1` antes de iniciar Python o el ejecutable, en el entorno construido por `main/utils/processor-spawn.js`. No asignarlo después de importar NumPy. La variante empaquetada tiene la misma detección de hardware, los mismos Jobs y encode que baseline.

| Processor empaquetado | Tiempo antes → después (s) | Pico privado antes → después (MiB) | RSS antes → después (MiB) |
| --------------------- | -------------------------: | ---------------------------------: | ------------------------: |
| Temporal              |              3.189 → 3.759 |                      695.1 → 341.1 |             337.5 → 336.3 |
| Inpaint               |              4.708 → 3.708 |                      691.7 → 335.8 |             335.2 → 331.9 |

La consulta directa a `scipy_openblas_get_num_threads64_()` del backend cargado confirmó **12 → 1 hilos** al cambiar el entorno. Después de los parches, el compromiso privado del propio Processor retenido en la copia siguiente bajó de **381.3 → 27.8 MiB**. No es una prueba de fuga: el backend y sus recursos permanecen cargados en el worker persistente. Tampoco es un ahorro de 350 MiB residentes. La velocidad varió en ambas direcciones; la propuesta se justifica por memoria privada. Nueve comparaciones del empaquetado y nueve de Python de desarrollo, todas exactas.

### 4. Acotar el decoder de forma condicionada

En `_build_cmd` de `python/processor.py`, establecer hilos **de entrada** para H.264 cuando se priorice memoria. No tocar `resolve_x264_threads`, filtros, codec, preset, CRF/CQ, fps ni resolución.

Confirmación H.264 blur: **644.1 → 572.8 MiB** en 1080p y **2148.3 → 1903.1 MiB** en 4K. Los contadores de pico individual del SO confirman **626.3 → 555.0 MiB** y **2130.6 → 1886.1 MiB** en FFmpeg. En QSV blur 4K: **864.4 → 605.6 MiB** para el árbol completo. Esta reducción aparece también en los otros perfiles medidos.

No recomendar dos hilos como aceleración universal ni aplicarlo ciegamente a HEVC: hay regresiones de tiempo y suficiente variación externa para no prometer mejoras de throughput. La resolución y calidad fueron exactas en todas las parejas correspondientes. La siguiente implementación debe conservar esa selección por codec y validarse con los videos habituales del usuario.

## Experimentos descartados

`gray-buffer` reutiliza componentes float32 al calcular gris; `motion-grid` cachea la grilla de muestreo. Conservan los resultados en 18 comparaciones, pero no reducen de forma material el pico del Job y los tiempos no son suficientemente consistentes. Por ejemplo, inpaint `gray-buffer` tuvo una ejecución de 6.950 s frente a una baseline de 4.107 s en esa repetición. No se proponen para producción.

Se midió también decoder con cuatro hilos: conserva calidad, pero ahorra menos memoria que dos y su velocidad no tuvo una mejora consistente. No se cambia perfil, preset, CRF/CQ, filtro, feather, radio temporal, resolución ni formato de píxel. No se propone GPU decode, cambiar FFV1 o recortar anticipadamente el procesamiento sin una nueva validación de todos los frames y tiempos.

## Evidencia y reproducción

- CSV: cada invocación (`.audit-tmp/job-perf-20261009-per-job.csv`).
- Serie principal (`.audit-tmp/job-perf-20261009-results-v3/report.json`), confirmación de perfiles (`.audit-tmp/job-perf-20261009-confirmation/report.json`), QSV (`.audit-tmp/job-perf-20261009-qsv/report.json`), codecs (`.audit-tmp/job-perf-20261009-codecs/report.json`).
- Exit-wait y microoptimizaciones (`.audit-tmp/job-perf-20261009-followup/report.json`), copia (`.audit-tmp/job-perf-20261009-copy/report.json`), diagnóstico de fases (`.audit-tmp/job-perf-20261009-stages/report.json`).
- OpenBLAS: Python (`.audit-tmp/job-perf-20261009-blas-comparison.json`), OpenBLAS: ejecutable (`.audit-tmp/job-perf-20261009-packaged-comparison.json`), invariantes de comandos (`.audit-tmp/job-perf-20261009-command-invariants.json`), copias byte por byte (`.audit-tmp/job-perf-20261009-copy-byte-equality.json`).
- Consulta de hilos al backend OpenBLAS (`.audit-tmp/job-perf-20261009-openblas-backend.json`).
- Fallos del arnés Electron (`.audit-tmp/beru-performance-VrEV7n/report.json`) y segundo intento (`.audit-tmp/beru-performance-8kojvT/report.json`).
- [Runner](../scripts/performance/audit-jobs.mjs), [experimentos aislados](../scripts/performance/job-audit-worker.py), [comparador entre procesos](../scripts/performance/compare-job-audits.mjs).
- Versiones medidas frente al código al cierre (`.audit-tmp/job-perf-20261009-source-provenance.json`).

Los JSON guardan binarios/hashes, payloads, comandos, fases, muestras y resultados; las carpetas incluyen NDJSON de memoria, logs, fingerprints y perfiles. Los artefactos grandes están en `.audit-tmp/`, ignorada por git; este informe y los runners son los archivos nuevos revisables.

Desde la raíz del repo, con un directorio de salida inexistente:

```powershell
node scripts/performance/audit-jobs.mjs .audit-tmp/job-perf-20261009-inputs/matrix-v2.json .audit-tmp/job-audit-new 3
node scripts/performance/compare-job-audits.mjs before-dir after-dir new-comparison.json
```

La matriz usa `scenarios: [{name, job, variants}]`; `processor: "packaged"` selecciona el ejecutable y admite únicamente `baseline` con variantes de entorno entre procesos. El runner crea outputs y directorios temporales propios. Los experimentos se cargan en memoria; nunca reescriben `python/`. Sus anclajes de reemplazo fallan explícitamente si la fuente ya no coincide; por ejemplo, `copy-buffer` necesita adaptarse al nuevo loop de progreso de la copia antes de repetirlo sobre el código actual.

## Verificación del repositorio

Esta auditoría solo añadió el informe y tres instrumentos en `scripts/performance/`; no modificó código de producción en `python/`, main ni renderer. Las comprobaciones globales se ejecutaron sobre el worktree del cierre, que incluye cambios ajenos posteriores a las mediciones; aprobar tests no extiende a esas fuentes las cifras de rendimiento anteriores.

- `npm run lint`: correcto, salida 0.
- `npm run format:check`: correcto, salida 0.
- `npm test`: la primera ejecución tuvo 1260 pruebas correctas y dos fallos porque las listas de vigilancia no incluían el nuevo módulo ajeno `process_lifetime`. Esas listas cambiaron durante el cierre; la repetición completa pasó **1263 pruebas en 178 archivos**, salida 0. Se conservan ambos logs.
- `npm run test:python`: **37 archivos correctos**, salida 0.
- Instrumentos: compilación sintáctica de Python, rechazo de una variante desconocida antes de crear outputs, nueva comparación exacta de las nueve parejas del empaquetado, revisión de enlaces locales y comprobación de integridad de las 197 comparaciones.

Evidencia: lint (`.audit-tmp/job-perf-20261009-verification/lint.log`), formato (`.audit-tmp/job-perf-20261009-verification/format.log`), primera suite JS (`.audit-tmp/job-perf-20261009-verification/test.log`), suite JS final (`.audit-tmp/job-perf-20261009-verification/test-recheck.log`), Python (`.audit-tmp/job-perf-20261009-verification/python.log`), instrumentos (`.audit-tmp/job-perf-20261009-verification/instrument-validation.json`), integridad (`.audit-tmp/job-perf-20261009-verification/evidence-integrity.json`).
