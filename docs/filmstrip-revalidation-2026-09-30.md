# Revalidación de la tira de fotogramas — 2026-09-30

La tira actual usa FFmpeg en el proceso principal. Este seguimiento sustituye las conclusiones sobre el hook de canvas/worker del [seguimiento inicial](performance-audit-2026-09-30.md); sus mediciones siguen siendo evidencia histórica de aquella implementación. La entrega progresiva reduce la espera hasta la primera muestra; no se demuestra una reducción del tiempo total de extracción.

## Evidencia previa y decisiones

- El renderer esperaba las 20 imágenes y solo ignoraba la respuesta al cambiar de video: el proceso principal continuaba extrayendo.
- La caché del renderer usaba únicamente la ruta y evitaba revalidar el archivo. La caché principal omitía la duración: solicitar 10 segundos tras una tira de 12 segundos devolvía las mismas imágenes.
- Las muestras fallidas se eliminaban de la lista, desplazando las restantes respecto de su posición temporal.
- Se conservan 20 puntos medios, altura 64, calidad JPEG y los límites de threads. Se priorizan muestras del inicio, centro y final; los resultados se publican con índice fijo.

## Cambios

[extractFilmstrip](../main/utils/thumbnail.js) mantiene hasta cuatro extracciones admitidas o pendientes por solicitud, en lugar de encolar 20 inmediatamente. El pool global sigue aplicando prioridad interactiva, presupuesto de RAM y capacidad de exportación; cuatro es un límite conservador por tira, no un óptimo demostrado para equipos con RAM abundante.

El [handler](../main/handlers/video.js) identifica cada solicitud y su ventana. Un cambio de selección, desmontaje, navegación o cierre cancela el trabajo. El [pool](../main/utils/media-task-pool.js) retira tareas pendientes y [runCapturedProcess](../main/utils/run-captured.js) propaga AbortSignal a FFmpeg, esperando su cierre antes de devolver el slot en una cancelación. Los eventos llegan únicamente al propietario y las respuestas obsoletas se descartan.

El [hook](../src/components/video-preview/useFilmstripFrames.js) publica resultados parciales y revalida cada nueva selección mediante IPC. Se elimina su caché redundante. La caché principal conserva hasta 12 tiras completas mediante LRU, incluyendo identidad del archivo, tamaño, mtime, ctime, duración, cantidad y altura. No almacena resultados cancelados o incompletos; comprueba de nuevo el archivo antes de guardar. [LogoTimeline](../src/components/video-preview/LogoTimeline.jsx) conserva los slots temporales y usa la muestra disponible más cercana como relleno mientras faltan fotogramas.

## Comparación nativa

Tres procesos Electron nuevos por variante, perfiles aislados, mismo clip H.264 1080p/30 de 12 segundos, FFmpeg real y pool de producción. La versión previa proviene de una copia anterior a las ediciones. Se cronometra la API del proceso principal: antes el primer resultado coincidía con la tira completa; después es el primer callback. No son tiempos de pintura de pantalla ni arranques tras reiniciar Windows.

| Repetición | Primera muestra antes | Primera muestra después | Tira completa antes | Tira completa después |
| ---------- | --------------------- | ----------------------- | ------------------- | --------------------- |
| 1          | 5,836 s               | 0,371 s                 | 5,836 s             | 12,293 s              |
| 2          | 9,186 s               | 0,569 s                 | 9,186 s             | 11,686 s              |
| 3          | 9,517 s               | 0,418 s                 | 9,517 s             | 15,937 s              |
| Mediana    | 9,186 s               | 0,418 s                 | 9,186 s             | 12,293 s              |

Las 20 imágenes finales tienen hashes SHA-256 idénticos entre ambas versiones en las tres repeticiones. La mediana de la caché principal fue 1,19 ms antes y 0,65 ms después. Cambiar la duración ahora genera otras 20 muestras y cambia sus hashes; la aparente respuesta más rápida anterior era una reutilización incorrecta.

Al cancelar aproximadamente a los 50–267 ms y elegir otro video, la implementación anterior ejecutó los 20 FFmpeg del abandonado; la nueva inició uno, lo canceló y no publicó ni almacenó su resultado. En las repeticiones 2 y 3, los inicios posteriores a cancelar pasaron de 19 a cero. La versión nueva completó las 20 muestras del video siguiente en las tres repeticiones; la anterior solo completó 16 en la tercera por fallos de extracción bajo carga. El contador por fase de la primera repetición previa no identifica correctamente procesos antiguos que arrancan después de cambiar de fase; el informe utiliza la ruta de los procesos y conserva los datos originales.

La RAM libre al iniciar los procesos osciló entre 70 y 724 MiB, con carga externa variable. La mediana de la tira completa aumentó de 9,186 a 12,293 s. Por ello, no se atribuye al cambio una mejora de throughput, CPU agregado o memoria máxima, ni se presenta esta comparación como aislamiento de una regresión causal. El beneficio confirmado es la disponibilidad inicial, detener trabajo abandonado y la validez de la caché. Sigue pendiente optimizar el coste de los 20 seeks/procesos y comparar concurrencia con carga y memoria controladas.

## Integración y fluidez

Electron real ejercitó preload, seguridad de rutas, handlers, hook y LogoTimeline en un fixture de componente con CSS de diagnóstico. La primera prueba decodificó imágenes a los 477 ms en frío y 397 ms tras cambiar la selección; la tira en caché devolvió 20 imágenes en 6,00 ms sin iniciar FFmpeg. Reemplazar el archivo inició 20 procesos nuevos; borrarlo devolvió cero imágenes sin iniciar procesos. Solo un FFmpeg del video abandonado llegó a iniciarse, y ninguno después del cambio.

La ventana del fixture permaneció oculta. Sus imágenes se decodifican y existen en el DOM, pero esto no certifica pintura visible, INP o 60 fps. La primera ejecución coincidió con la suite completa y registró pausas de rAF de aproximadamente un segundo: no se usan para atribuir fluidez comparativa. Las capturas y una repetición posterior sin la suite se conservan como comprobación de entrega progresiva; el fixture evita esperar decode() de todas las imágenes mientras sus src todavía cambian, porque esa observación puede abortarse durante una actualización normal.

En la repetición posterior se observó una muestra y 12 tiles en el DOM a los 254 ms, con una captura de la tira parcial, y llegaron los 20 eventos indexados. La observación de decode() inicial terminó a los 2.108 ms; no se sustituye ese valor por el tiempo menor del DOM. Persistieron pausas de rAF de un segundo en la ventana oculta. El cambio posterior de selección decodificó a los 170 ms y la caché IPC respondió en 4,98 ms sin nuevos procesos. Se verificó la entrega, pero sigue pendiente medir la fluidez en una ventana visible y con carga controlada.

## Verificación y límites

- Pruebas focalizadas: 9 archivos, 65 casos correctos. Cubren publicación y posición temporal, respuestas obsoletas, revalidación, archivos reemplazados/eliminados, tiras parciales, propiedad por ventana, cancelación pendiente y cierre de un hijo real.
- Suite completa: npm test, 154 archivos y 1.073 casos correctos. No se editó código ni tests mientras se ejecutaba Vitest.
- ESLint y Prettier de los 14 archivos de código/tests de este cambio pasaron; git diff --check delimitado pasó.
- npm run lint global pasó en la comprobación final. npm run format:check continúa fallando por cuatro documentos ajenos en docs/audits/2026-09-30-thermo-nuclear/: 00_summary.md, 07_verify_main.md, 08_verify_renderer.md y 09_verify_tooling_tests.md. Se preservaron esas ediciones; no se declara aprobado el formato global.
- No se modificó Python, se construyó instalador, se creó commit ni se publicó contenido. No se usaron subagentes.

La [evidencia JSON](filmstrip-revalidation-2026-09-30.json) contiene muestras, procesos, hashes del código antes/después e integración. Los respaldos, lanzadores, capturas y logs están en C:/Users/HIDROAA/AppData/Local/Temp/beru-performance-audit-20260930/filmstrip-current. No se reseteó la caché del sistema operativo ni se midieron 4K/HEVC, proyectos grandes o sesiones prolongadas.
