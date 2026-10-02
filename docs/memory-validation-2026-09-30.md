# Validación de memoria — 2026-09-30

Se implementó un arnés reproducible para ampliar la [auditoría de rendimiento](performance-audit-2026-09-30.md) y se corrigió una subestimación de QSV. **La validación con grabaciones reales sigue pendiente:** los medios disponibles de esta auditoría son sintéticos. No se declara validada la política para todas las cámaras, encoders ni sesiones de varias horas.

El [protocolo y comandos](memory-validation.md) permite ejecutar los mismos controles con medios reales sin reutilizar la sesión del usuario. La [evidencia numérica JSON](memory-validation-2026-09-30.json) conserva los resultados, procedencia de entradas y ubicaciones de los logs y muestras nativas completos. Los hashes finales del código se distinguen de los resultados de la sesión anterior del arnés.

## Procesado y ajuste

Windows 11, i5-12400, Intel UHD Graphics 730, controlador 32.0.101.7088, 7,78 GiB de RAM visible. Se usó Python del sistema y el procesador fuente del checkout local, no el ejecutable empaquetado. FFmpeg codificó las entradas sintéticas: seis segundos de `testsrc2`, H.264 1080p/30 fps y HEVC 4K/24 fps de 10 bits, ambos con AAC estéreo. Los trabajos de codificación exportan cuatro segundos; copia/remux conserva los seis segundos.

La serie confirmatoria corre tres pasadas en un mismo worker persistente: 72 trabajos de copia/remux y 21 de codificación, todos terminados sin fallos ni reintentos. ffprobe confirmó video, duración positiva y presencia de audio en las 93 salidas. Los dos trabajos de cada caso de codificación usan la misma fuente; no se simula diversidad de cámaras. Las aplicaciones del usuario permanecieron abiertas. Se reservaron ventanas de medición entre agentes para no ejecutar simultáneamente builds, benchmarks ni suites.

| Caso confirmatorio                                          | Pico privado de un FFmpeg, rango de tres pasadas | Estimación por tarea posterior |
| ----------------------------------------------------------- | -----------------------------------------------: | -----------------------------: |
| H.264 1080p con audio, desenfoque, texto y recorte; QSV     |                                      289–316 MiB |                        432 MiB |
| HEVC 4K/10 bits con audio y texto; QSV, salida 4K           |                                  1.168–1.201 MiB |                      1.350 MiB |
| HEVC 4K/10 bits con audio, desenfoque, texto y recorte; QSV |                                    979–1.114 MiB |                      1.350 MiB |
| Misma cadena compuesta con perfil `uquality`, software      |                                  1.630–1.631 MiB |                      4.362 MiB |
| Copia/remux de 24 archivos H.264 con audio por pasada       |                                30 MiB por FFmpeg |   128 MiB en admisión de copia |

Las cadenas con recorte generan 1.800 × 1.000 píxeles; su coste no equivale a codificar una salida 4K completa. Las muestras incluyen probes del preflight y permiten identificar la mayor concurrencia de FFmpeg, pero el máximo de probes no es el número de trabajos de codificación. En la serie final QSV admitió uno o dos trabajos 1080p y uno 4K; software admitió uno. El pool de copia mantuvo dos slots. El working set no se utiliza para calibrar bytes privados ni se interpreta como memoria total exclusiva.

Una serie exploratoria detectó un pico privado de 1.229 MiB para QSV 4K y 316 MiB para QSV 1080p, frente a estimaciones anteriores de 900 y 288 MiB. No se utiliza esa serie como comparación causal de tiempos o memoria agregada: pudo coincidir parcialmente con otras verificaciones del checkout. La serie confirmatoria aislada sigue mostrando el mismo problema respecto a la estimación antigua: hasta 1.201 MiB frente a 900 MiB.

Se aumentó únicamente la base QSV de 128 a 192 MiB en [workerPolicy.js](../main/workerPolicy.js) y [capacity.py](../python/capacity.py). Manteniendo los multiplicadores existentes, los casos anteriores pasan a 1.350 y 432 MiB. No se redujeron los márgenes de software ni se cambiaron los demás encoders. El ajuste cubre los picos observados; no es una constante certificada para clips largos o hardware distinto.

Las dos regresiones de admisión fueron rojas antes del ajuste y verdes después: con 2.600 MiB disponibles, JS y el procesador no admiten dos tareas QSV HEVC/10 bits filtradas 4K; con 4.000 MiB permiten dos. Se comprueba comportamiento de admisión, no solamente el valor de la constante.

La disponibilidad mínima durante una exportación confirmatoria fue aproximadamente **116 MiB**. La política conserva un mínimo de una tarea aunque su estimación no quepa en el presupuesto; por eso el cap automático no garantiza ausencia de presión, paging ni OOM. Este seguimiento no introduce una pausa indefinida de la primera tarea ni altera el override manual.

El worker volvió a aproximadamente 19–21 MiB privados en los reposos posteriores. Quince lotes en unos tres minutos no demuestran estabilidad del procesador durante horas; la sesión larga siguiente se refiere a Electron y paneles, no a codificación continua.

## Fallo independiente conservado

El primer piloto usó un trabajo sin filtros pero con recorte. El preflight no comprobó un encoder porque `_jobs_allow_hardware` solo considera operaciones/marca de agua; después el trabajo detectó NVENC sin verificarlo, aunque el equipo tiene Intel UHD. FFmpeg terminó con `Error while filtering: Operation not permitted`; el procesador lo presentó como fallo de permisos de salida. La serie se marcó fallida y se conserva, no se mezcla con mediciones válidas.

Este problema preexistente del camino de recorte sin filtros no se corrigió dentro de la calibración. El caso de copia/remux no usa recorte y los casos de codificación contienen operaciones para ejecutar el preflight verificado. No se anuncia validación del camino de recorte sin filtros.

## Proyecto grande y paneles conservados

El renderer se compiló en una carpeta temporal, con Supabase deshabilitado y perfil nuevo de Electron. El proyecto de estrés tiene 500 entradas que referencian la misma fuente, diez regiones de texto por entrada y 5.000 filas de Excel con diez columnas de texto. Es estado sintético inyectado en un build instrumentado; no mide importación ni cachés de 500 archivos diferentes.

La sesión completó veinte ciclos de los seis paneles durante unos quince minutos de repetición. Se muestreó el heap después de GC forzado y contadores del DOM. Los siguientes puntos conservan todos los modales cerrados:

| Punto                                         | Heap JS retenido | Nodos | Listeners |
| --------------------------------------------- | ---------------: | ----: | --------: |
| Arranque vacío, sin paneles abiertos          |         4,82 MiB |   457 |     1.499 |
| Proyecto grande, antes de abrir paneles       |        21,44 MiB | 1.623 |     1.638 |
| Todos los paneles abiertos y cerrados una vez |        24,21 MiB | 2.657 |     2.232 |
| Ciclo 10                                      |        31,45 MiB | 2.657 |     2.233 |
| Ciclo 17                                      |        31,86 MiB | 2.663 |     2.234 |
| Ciclo 20 y fin de repetición                  |        31,83 MiB | 2.663 |     2.234 |
| Proyecto vaciado, paneles conservados         |        24,17 MiB | 1.613 |     1.675 |

Después del primer uso, el coste cerrado aumenta unos 2,77 MiB sobre el proyecto sin paneles. Durante los ciclos posteriores sube otros 7,62 MiB y las últimas muestras se estabilizan; no hay crecimiento proporcional de nodos/listeners en esos puntos. Esto no prueba que no existan fugas: no se capturó un heap snapshot con cadenas de retención y faltan sesiones más largas y cambios de proyecto. Vaciar la cola/Excel tampoco vuelve al heap inicial; pueden intervenir caches de sesión y nombres de salida, además de estados locales conservados. No se atribuye ese residual exclusivamente a `DeferredPanel` ni se desmontan paneles de forma especulativa.

**Esta serie no pasó su comprobación final.** La paleta intentó cargar sprites ausentes y URLs remotas bloqueadas por la CSP existente. Además, la ventana pasó parte de la sesión oculta; las esperas de `requestAnimationFrame` se ralentizaron. Una muestra del ciclo 11 tenía un modal abierto y queda fuera de la tabla anterior. Al reabrir la tabla después de vaciar el proyecto, el arnés esperaba `.table-editor`, aunque el componente correctamente no la muestra sin entradas. Ese último fallo es del arnés, no de producción. Se conservan el código de salida 1 y las observaciones, sin anunciar una sesión limpia ni una mejora de fluidez.

Los resultados dan un orden de magnitud del coste retenido y una pista para investigar las caches; no justifican cambiar la preservación de estado de los paneles. Para completar el escenario se necesitan recursos de mascotas válidos, mediciones equivalentes de cierres confirmados y proyectos/medios reales.

El muestreo nativo de esa sesión registró 4.484 muestras: pico agregado de 585 MiB privados y 611 MiB de working set, con un intervalo máximo de 386 ms. La disponibilidad del sistema llegó a 15,6 MiB; ese dato incluye presión de aplicaciones ajenas, no solo el proyecto de Beru. No se interpreta como prueba de que los paneles consumieran toda la RAM.

Al intentar la verificación posterior, el mismo FFmpeg dejó de poder crear archivos nuevos en Temp: un comando independiente de Beru, con `testsrc2` de 64 × 64 y 0,2 segundos, devuelve `Permission denied`. Node sí crea la carpeta, pero FFmpeg no crea su salida. Ese bloqueo apareció después de las 93 salidas válidas y limita las comprobaciones nativas posteriores; no se atribuye al ajuste de QSV ni se desactiva la protección del equipo para eludirlo.

Se corrigió el arnés para confirmar el cierre del DOM, evitar esperas de pintura en segundo plano, omitir la tabla del proyecto vacío y poder excluir explícitamente la paleta si sus recursos no están disponibles. El build de comprobación posterior pasó, pero el comando terminó con código 3 antes de crear el perfil de Electron y el muestreador no capturó datos. Esa repetición no valida las correcciones en runtime; se documenta como bloqueo adicional del entorno. El lanzador final conserva logs y genera un resultado fallido también cuando Electron termina antes de reportar.

## Cobertura que falta

- Grabaciones reales 4K/HEVC de distintas cámaras, 8 y 10 bits, clips largos, audio multicanal y otros codecs de audio.
- Salida software 4K completa con cadenas compuestas, mayor cantidad de filtros y una sesión de procesado continuo de 60–120 minutos.
- NVENC, AMF y otros equipos, incluyendo límites de commit reducidos y GPU dedicada; no extrapolar la calibración QSV a ellos.
- Proyectos reales con cientos de rutas distintas, imágenes de marca de agua, cambios repetidos de proyecto y todas las pestañas de ajustes.
- Instalador y `beru-processor.exe` recompilado. No se reconstruyó ni publicó un release.

## Verificación y estado de entrega

- `npm run lint` y `npm run format:check` pasaron. Los dos arneses JS pasan `node --check`; se revisaron enlaces, JSON y el diff propio. La producción cambia únicamente la base QSV en las dos políticas, preservando modificaciones preexistentes del checkout.
- Las 57 pruebas focalizadas de capacidad y contratos del procesador pasaron, incluidas las dos nuevas regresiones de admisión. También pasaron dentro de la suite completa posterior.
- `npm test`: 158 archivos y 1.084 casos pasaron. Fallaron `preview-frame-seek.test.js` al crear su fixture y un caso de `main.videoProbe.test.js` al crear su video. Ambos requieren escritura nativa de FFmpeg y reproducen el bloqueo independiente descrito arriba; no se cambiaron ni debilitaron esas pruebas.
- `npm run test:python`: pasaron los cinco primeros archivos y se detuvo en `test_delogo.py` al no poder crear la imagen de portada con FFmpeg. Los otros 22 archivos no se ejecutaron en esta pasada. No se presenta la suite Python como aprobada.
- El build instrumentado pasó con el aviso existente de chunks mayores de 500 kB. La serie de procesado confirmatoria pasó; la sesión larga de paneles y la verificación posterior del arnés tienen las limitaciones registradas.

Se dejan cambios locales sin commit, push ni PR. Falta recibir una carpeta autorizada con medios reales y resolver el bloqueo de escritura/arranque nativo antes de completar la validación y repetir las comprobaciones pendientes.
