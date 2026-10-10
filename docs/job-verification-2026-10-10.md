# Verificación ampliada de Jobs — 2026-10-10

Las rutas bajo `.audit-tmp/` identifican evidencias locales de la auditoría original, ignoradas por Git. Esos archivos no están disponibles en el checkout actual; las mediciones históricas de este informe no se han vuelto a comprobar en esta limpieza.

La ampliación terminó con **177 exports medidos**: 102 del video real o su remux sin pérdida y 75 sintéticos en una sesión persistente. Además se recuperó la calidad de nueve exports completos de la sesión interrumpida. **Las 140 comparaciones de frames y audio fueron exactas**. La reducción de memoria privada del Processor conserva la calidad del video suministrado. Los tiempos varían considerablemente entre tandas: esta ampliación no demuestra una aceleración general. El decoder limitado a dos hilos sigue siendo un experimento; no se incorporó a producción. Los nuevos cuellos de botella descritos abajo requieren otra implementación y su propia verificación de calidad.

Esta ampliación complementa la [auditoría inicial](job-performance-audit-2026-10-09.md) y la [implementación verificada](job-optimizations-2026-10-09.md). No cambia parámetros de encode, filtros, resolución ni código de producción. Se amplió el instrumental de `scripts/performance/` para capturar Jobs concurrentes, fases, CPU y picos de cada proceso hijo; los controles anteriores se aplican únicamente dentro del proceso de auditoría.

## Fuente y método

Equipo medido: Intel Core i5-12400, 12 CPUs lógicas y 7968 MiB de memoria física, Windows; Node 22.13.0 y Python 3.14.8 del entorno local. El encoder hardware utilizado es `h264_qsv`. Los informes incluyen SHA-256 de FFmpeg y código del worktree `d707a2da60a6dc0226237481f9778174a65d0b11`; ese commit no representa por sí solo los cambios locales existentes.

Se utilizó `C:\Users\HIDROAA\Downloads\20260925\20260925_095006.mp4`, sin modificarlo: 82.095.182 bytes, SHA-256 `4ee0248faed810b114dabf2698e5349dbcf39764cd09578f5d0028526b9309bf`. Es H.264 Baseline, 1920 × 720, `yuv420p`, 3266 frames y 130,603125 s de video; el audio AAC mono de 16 kHz dura 215,2405 s. El contenedor dura 215,2815 s. La duración del contenedor no se utilizó como sustituto de la duración del video.

Sin un preset habitual proporcionado, se mantuvo `balanced` y regiones fijas: blur de 320 × 180 en (100,120), fuerza 20; temporal/inpaint de 120 × 60 en (200,200), feather 6 y radio 3. Las pruebas cortas tienen trim y ventana activa de operación 0–12 s iguales en ambos lados. La prueba temporal sin ventana activa prepara la fuente completa aunque el export tenga trim. Estos son escenarios diferentes; no se usan sus diferencias como prueba de una optimización del producto.

Los controles `pre-optimizations` reconstruyen en memoria la copia anterior que asignaba bloques de 8 MiB y la espera anterior con `sleep(0.2)`. Los procesos anteriores arrancan sin override OpenBLAS; los actuales arrancan con `OPENBLAS_NUM_THREADS=1`. El A/B empaquetado cambia solo ese entorno en el mismo ejecutable actual. No compara dos versiones históricas del binario.

Después de detener el muestreo se decodificaron **todos** los frames y todo el audio de cada export. `framemd5` mantiene el formato de píxel nativo y registra frames, tiempos y muestras de audio PCM; no se basa en miniaturas ni imágenes de unos pocos puntos. Para los controles de producción se compararon además los argumentos completos de todos los FFmpeg capturados, normalizando exclusivamente rutas de salida y temporales. El ejecutable empaquetado no expone los argumentos por PID; ese campo queda sin medición.

La carpeta de evidencia comenzó el 9 de octubre: resumen completo (`.audit-tmp/job-verification-20261009/summary.json`), cada Job en CSV (`.audit-tmp/job-verification-20261009/per-job.csv`), entrada (`.audit-tmp/job-verification-20261009/input.json`). Los informes crudos conservan matriz, timestamps, entorno, hashes del código y ejecutable, comandos, tiempos y muestras de memoria.

### Qué significa cada pico

- **Memoria privada**: commit privado de Windows, en MiB; no equivale a RAM física residente.
- **RSS**: working set residente. Sumar RSS de procesos puede contar páginas compartidas varias veces.
- **Árbol por intervalo de Job**: máximo simultáneo observado del worker y sus descendientes mientras corre ese Job. En concurrencia incluye otros Jobs solapados; no se atribuye como consumo exclusivo del Job.
- **Hijos propios**: máximo simultáneo observado de los PIDs lanzados por ese Job. Python es compartido y se informa aparte. Los picos de varios hijos medidos por el SO no se suman como si fueran simultáneos.
- **Pico del SO por hijo**: `PeakWorkingSetSize` y `PeakPagefileUsage` recuperados del handle tras salir. Complementan el muestreo de procesos cortos. Los contadores del propio Python son de toda la vida del proceso y no se reinician entre Jobs.
- **CPU**: CPU del hilo ejecutor cuando el informe registra explícitamente ese alcance, CPU del proceso Python solo cuando es aislado/serial, CPU de cada hijo y CPU total del batch concurrente. La CPU del hilo no representa toda la CPU de NumPy ni todos los hilos Python. Las primeras tandas aisladas no guardaban un campo de alcance: sus valores históricos se conservan como `recordedPythonCpuSeconds`, con alcance sin registrar, y no se convierten en CPU de hilo o proceso en el CSV.

El muestreador solicita 50 ms; se registra también el máximo intervalo real. Bajo carga hubo intervalos mayores. Un pico muestreado es una cota inferior; cero muestras significa medición insuficiente. La máquina y su carga no estuvieron aisladas. Las tandas anteriores/actuales separadas no permiten atribuir por sí solas un cambio de tiempo a una modificación concreta.

Se detectó y corrigió un error de identificación en la auditoría: Windows reutilizó para el launcher Python el PID 1132 de un padre antiguo de `winlogon.exe`. Seguir únicamente números de PID incorporaba `winlogon`, `fontdrvhost` y `dwm` al árbol de `native-after`. Los tres procesos habían sido creados antes del worker y no pertenecían al Job. Se conservaron el informe y las muestras originales; una corrección documentada (`.audit-tmp/job-verification-20261009/native-after-memory-correction.json`) recalcula exclusivamente esos picos del árbol. El muestreador ahora exige que cada hijo sea posterior a su padre y verifica que el handle siga representando la misma creación; también detecta reutilización del PID raíz. Se repitió el A/B de copia y se validaron los timestamps de todos sus árboles. El CSV usa los picos corregidos; los contadores directos del SO de Python no habían sido afectados.

La revisión de identidades de todas las muestras disponibles (`.audit-tmp/job-verification-20261009/process-identity-audit.json`) encontró esa contaminación únicamente en `native-after`. En los Jobs de fuente no aparecieron PIDs de FFmpeg/ffprobe ajenos a los capturados, y ningún intervalo tuvo más de los dos procesos esperados del worker. Los informes históricos sin fechas de creación no ofrecen la misma garantía que el muestreador corregido.

## Video real completo

Medianas por Job aislado. `n` es el número de exports por lado. Los picos son del árbol simultáneo, no la suma de picos individuales.

| Job                                             |   n | Tiempo anterior → actual (s) | Privada anterior → actual (MiB) | RSS anterior → actual (MiB) |
| ----------------------------------------------- | --: | ---------------------------: | ------------------------------: | --------------------------: |
| Sin operaciones, MP4 faststart                  |   2 |                0,663 → 0,322 |                     42,3 → 38,5 |                 64,8 → 61,7 |
| Remux a MKV                                     |   2 |                1,411 → 0,631 |                     40,2 → 39,2 |                 62,8 → 62,2 |
| Blur software                                   |   2 |              48,508 → 97,045 |                   457,6 → 456,7 |               410,6 → 421,7 |
| Blur QSV                                        |   2 |              21,597 → 21,929 |                   583,4 → 592,4 |               240,3 → 233,9 |
| Temporal software, trim 12 s sin ventana activa |   1 |            175,314 → 165,558 |                   830,5 → 477,0 |               418,4 → 413,5 |

Nueve comparaciones exactas y comandos iguales (`.audit-tmp/job-verification-20261009/real-comparison.json`). El MP4 original tiene `moov` después de `mdat`; el Job sin operaciones ejecuta FFmpeg para faststart. **No es copia nativa** y no verifica por sí solo el buffer `readinto`.

En temporal, la memoria privada Python bajó de **389,1 a 35,4 MiB**; RSS del árbol cambió solo de 418,4 a 413,5 MiB. La preparación consumió 164,037 → 155,806 s y el FFmpeg final 11,247 → 9,658 s. El trabajo previo al encode domina este caso.

El blur software presentó una regresión observada cercana a 2× en estas tandas. Todos sus frames, audio y comandos coinciden. No se atribuye automáticamente a la carga ni se declara que la optimización lo acelera. El control alternado de espera del apartado posterior separa el cambio de polling de los demás cambios.

## Ventanas de operación y trim de 12 segundos

| Job               |   n | Tiempo anterior → actual (s) | Privada anterior → actual (MiB) | RSS anterior → actual (MiB) |
| ----------------- | --: | ---------------------------: | ------------------------------: | --------------------------: |
| Temporal software |   1 |              16,126 → 22,525 |                   827,0 → 477,1 |               437,3 → 433,5 |
| Inpaint software  |   2 |              21,170 → 40,759 |                   828,2 → 477,6 |               418,5 → 406,1 |
| Inpaint QSV       |   2 |              22,744 → 20,046 |                   634,6 → 281,0 |               253,3 → 255,0 |

Cinco comparaciones exactas y comandos iguales (`.audit-tmp/job-verification-20261009/bounded-comparison.json`). La reducción de privada se repite en ambos caminos de parches. Los tiempos no muestran una mejora uniforme.

## Concurrencia efectiva

Cada lote contiene temporal, inpaint, blur y remux del video real. Se realizaron tres lotes por condición. Para evitar modificar parámetros del encoder, la referencia serial conserva el contexto de dos workers de la condición concurrente. La condición concurrente utiliza el scheduler real, con dos workers y un worker de copia/remux.

| Condición            | Lote mediano (s) | Pico privado mediano (MiB) | Pico RSS mediano (MiB) | Jobs simultáneos observados | Python privado en reposo, mediana (MiB) |
| -------------------- | ---------------: | -------------------------: | ---------------------: | --------------------------: | --------------------------------------: |
| Serial actual        |           34,122 |                      285,6 |                  256,1 |                           1 |                                    28,3 |
| Concurrente anterior |           44,781 |                      894,9 |                  457,0 |                           3 |                                   381,6 |
| Concurrente actual   |           34,656 |                      363,8 |                  340,0 |                           3 |                                    27,7 |

Doce comparaciones serial/concurrente (`.audit-tmp/job-verification-20261009/serial-concurrent-comparison.json`) y doce anterior/actual (`.audit-tmp/job-verification-20261009/concurrent-comparison.json`), con frames/audio y comandos iguales. El scheduler sí solapa tres Jobs; el remux corre además de los dos Jobs del pool principal.

La reducción del árbol incluye menos commit compartido de Python y cambios en el solapamiento de fases; no se atribuyen los 531 MiB completos a un único Job. La concurrencia actual no mostró un beneficio de throughput frente a la ejecución serial en estos lotes. Esto justifica perfilar la preparación concurrente antes de ampliar workers o cambiar admission.

## Decoder a dos hilos: experimento sin implementar

Tres repeticiones alternadas por condición, sobre exports de 12 s del mismo video real. Solo se añade `-threads 2` antes del primer input del FFmpeg final. El decoder del pipeline de parches sigue a un hilo. El resto de argumentos se comprueba exactamente.

| Job              | Tiempo total baseline → decoder 2 (s) | FFmpeg final baseline → decoder 2 (s) | Privada del árbol baseline → decoder 2 (MiB) | Mayor pico commit FFmpeg del SO baseline → decoder 2 (MiB) |
| ---------------- | ------------------------------------: | ------------------------------------: | -------------------------------------------: | ---------------------------------------------------------: |
| Blur software    |                         9,163 → 7,250 |                         9,155 → 7,248 |                                455,4 → 400,5 |                                              435,8 → 380,9 |
| Blur QSV         |                         5,047 → 5,061 |                         5,033 → 5,059 |                                259,0 → 205,2 |                                              244,9 → 186,0 |
| Inpaint software |                       18,739 → 18,015 |                         4,041 → 3,746 |                                476,6 → 421,3 |                                              446,3 → 391,8 |

Nueve comparaciones de frames/audio exactas (`.audit-tmp/job-verification-20261009/decoder/report.json`). La reducción de memoria del decoder se repite en este H.264 Baseline, pero QSV no acelera. La auditoría inicial mostró una ralentización en HEVC: no hay evidencia para imponer un límite global ni para extrapolar este único video a todos los codecs.

## Comprobaciones finales

### Espera de FFmpeg, control alternado sobre el video completo

Se ejecutó blur software completo en orden actual–anterior–anterior–actual, con OpenBLAS a uno en ambos lados. Los cuatro exports conservaron frames y audio exactos, y todos los argumentos de FFmpeg coincidieron.

| Espera                           | Tiempos individuales (s) | Mediana (s) | Pico privado mediano (MiB) | Demora tras salir FFmpeg, mediana (ms) |
| -------------------------------- | ------------------------ | ----------: | -------------------------: | -------------------------------------: |
| Actual, `proc.wait(timeout=0.2)` | 38,150; 37,238           |      37,694 |                      456,8 |                                    9,7 |
| Anterior, `sleep(0.2)`           | 42,559; 39,914           |      41,236 |                      457,2 |                                  129,6 |

La demora posterior a la salida sí mejora. La diferencia de tiempo total no se explica solo por esos milisegundos: el CPU de los hijos también varió, de una mediana de 285,0 s con espera anterior a 266,5 s con espera actual. El control no reprodujo la regresión de 48,5 → 97,0 s del primer barrido ni demostró que la espera nueva la causara. La causa de la variación entre tandas sigue sin aislarse; no se publica un porcentaje general de aceleración. Cuatro exports y dos comparaciones internas (`.audit-tmp/job-verification-20261009/wait-full/report.json`); la invariancia de comandos se verifica también en el resumen.

### Ejecutable empaquetado y copia nativa real

Inpaint QSV de 12 s, dos repeticiones por lado, mismo ejecutable `9747b062cf571c31a133a9c8078950419602f6902f83c84ef250c71051018336`:

| Entorno               | Tiempo mediano (s) | Privada del árbol mediana (MiB) | RSS del árbol mediano (MiB) | Privada del Processor mediana (MiB) |
| --------------------- | -----------------: | ------------------------------: | --------------------------: | ----------------------------------: |
| OpenBLAS sin override |             17,110 |                           635,4 |                       289,5 |                               392,2 |
| OpenBLAS a un hilo    |             15,875 |                           280,4 |                       287,7 |                                39,3 |

Los logs confirman QSV en ambos Jobs actuales. Dos comparaciones del ejecutable (`.audit-tmp/job-verification-20261009/packaged-comparison.json`) y otras dos de fuente/ejecutable son exactas. La ganancia es de commit privado; el RSS cambia poco. No se infiere una mejora uniforme de tiempo a partir de dos muestras.

Para activar la copia nativa se utilizó el remux faststart ya verificado del video real. Se produjeron doce copias entre el A/B inicial y su repetición con el muestreador corregido: **todos los archivos completos tienen el SHA-256 del input derivado**, sin cambios de bytes. La repetición midió un pico de commit del SO del cuerpo Python de **32,7 → 24,2 MiB**, mediana de tres copias por lado, en procesos frescos dedicados a copia. Son contadores de vida del proceso, incluidos arranque y copias anteriores; no se presentan como picos reiniciados por Job. El pico muestreado del árbol fue 34,7 → 26,2 MiB, pero cada copia solo tuvo entre una y cuatro muestras: los contadores del SO respaldan mejor el ahorro. Tiempos medianos 0,130 → 0,107 s, con rangos solapados; no se promete mayor velocidad.

A/B nativo (`.audit-tmp/job-verification-20261009/native-comparison.json`), A/B con identificación corregida (`.audit-tmp/job-verification-20261009/native-confirm-comparison.json`), SHA-256 de las doce copias (`.audit-tmp/job-verification-20261009/summary.json`).

### Processor persistente

Una sola instancia ejecutó **25 lotes y 75 Jobs durante 621,929 s**, con 20 s de reposo entre lotes. Cada lote contiene temporal, inpaint y copia de un fixture sintético H.264 1080p de cuatro segundos, con el scheduler real. La duración incluye los reposos; no son diez minutos continuos de encode ni una sesión del renderer.

Privada de Python en reposo: mediana **28,98 MiB** después del primer lote y **28,22 MiB** después del último; las 25 medianas estuvieron entre 27,50 y 28,98 MiB. No se observó un crecimiento sostenido en este intervalo. Esto no descarta fugas con otros datos o sesiones más largas. El mayor pico simultáneo del árbol fue **488,5 MiB privados y 461,5 MiB RSS**. El muestreo observó máximos de dos o tres Jobs según el lote; la copia corta puede terminar entre muestras.

Las 72 comparaciones de cada repetición contra el primer lote fueron exactas y sus comandos coincidieron. Los nueve Jobs terminados del intento interrumpido también coinciden con los tres anchors de la sesión completa, pero se contabilizan como recuperación de calidad independiente. Sesión completa (`.audit-tmp/job-verification-20261009/session-resumed/report.json`), recuperación del intento interrumpido (`.audit-tmp/job-verification-20261009/session-recovered-quality.json`).

### Comprobaciones del repositorio

`npm run verify` terminó con código 0: lint y formato correctos, **1269 pruebas JavaScript en 180 archivos** y **38 archivos de pruebas Python** correctos. También pasó `py_compile` del instrumental Python. Las integraciones reales verificaron el scheduler, los Jobs aislados, el ejecutable empaquetado y el muestreador con fechas de creación. Log completo de verificación (`.audit-tmp/job-verification-20261009/verification/verify.log`).

## Trabajo pendiente que sí merece otra implementación

1. **Preparación temporal consciente del trim.** Antes de limitarla, definir el intervalo mínimo requerido por el export y todos sus frames donantes, incluido el contexto temporal. Verificar CFR/VFR, ventanas activas, feather, bordes, fallback y timestamps con todos los frames. Las dos pruebas de 12 s de este informe tienen ventanas activas distintas y no constituyen un A/B de esta propuesta. No se alteraron las regiones ni el radio para conseguir una mejora aparente.
2. **Calibrar admission con el pipeline real.** El blur QSV completo estima 288 MiB, pero un solo FFmpeg alcanzó 578,9–579,7 MiB de pico commit del SO y el árbol actual unos 592 MiB. En software la estimación fue 768 MiB frente a unos 457 MiB observados. Hace falta un modelo por ruta y fase. Cambiar workers puede alterar hilos de encode; una modificación de admission exige repetir la equivalencia de comandos y calidad.
3. **Perfilar el solapamiento de preparación y encode.** Los lotes concurrentes actuales no superaron al control serial con el mismo contexto de encode. Medir antes de limitar o ampliar pools; no se estableció la causa con un perfil de CPU de todo el proceso.
4. **Sesión de la aplicación completa.** Electron 43.7.7 sale con `0x80000003` antes de producir resultados. Vite compila, y la invocación mínima de Electron también falla. No se conoce la causa; los logs se conservan. Heap renderer, proceso GPU, previews y memoria total de la aplicación siguen sin medición. La sesión del Processor no sustituye esta prueba.

Diagnóstico mínimo de Electron (`.audit-tmp/job-verification-20261009/electron-startup-diagnostic.json`), reintento tras reanudar, mismo fallo (`.audit-tmp/job-verification-20261009/electron-startup-diagnostic-resumed.json`), intento del harness de aplicación (`.audit-tmp/job-verification-20261009/beru-performance-UTmHLr`).

## Trazabilidad y límites

El primer barrido real se detuvo al descubrir que temporal preparaba el video completo. Se conservaron nueve Jobs terminados como subconjunto verificable; un export interrumpido se excluye. El primer intento de sesión persistente quedó interrumpido tras tres ciclos: se conservan los nueve Jobs terminados y se verifica su calidad por separado, sin presentarlos como una sesión de diez minutos.

Un label QSV del control corto decía `full` aunque el Job ya tenía trim y ventana activa de 12 s. El informe `bounded-before-canonical` corrige solo ese nombre después de comprobar que el Job coincide con el posterior salvo la ruta de salida. Conserva hash y referencia al informe original; no inventa exports nuevos.

Los archivos de evidencia están ignorados por Git y son locales. Los controles del harness y la extracción de fingerprints son reproducibles desde las matrices guardadas; no quedan overrides de auditoría en el código del producto. No se hizo commit, push, PR ni release.
