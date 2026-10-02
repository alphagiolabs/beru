# Auditoría de rendimiento de Beru — 2026-09-30

Los costes más claros aparecen al generar miniaturas y la tira de fotogramas. La importación ocupa aproximadamente 45–49 % de CPU total y alcanza 1,2 GiB de memoria residente agregada. La tira ejecuta conversiones síncronas del canvas en el hilo del renderer. La cola virtualizada y la reproducción con un desenfoque regional funcionan con fluidez en el escenario probado. No se modificó código de la aplicación ni se aplicaron optimizaciones.

Esta auditoría corresponde al checkout local, con 246 entradas preexistentes en `git status --short`, sobre `0d5a91043897db3cbea221e07ce83c7e9125f25e`; no representa ese commit limpio. Las mediciones aceptadas y los resultados de los perfiles se conservan en [la evidencia JSON](performance-audit-2026-09-30.json).

La [revalidación de la tira actual de FFmpeg](filmstrip-revalidation-2026-09-30.md) documenta su entrega progresiva, cancelación real y correcciones de caché. Las mediciones de canvas/worker de este documento corresponden a las implementaciones anteriores.

El [seguimiento de memoria](memory-validation-2026-09-30.md) añade arneses reproducibles, una matriz sintética con HEVC 4K/10 bits, audio y varios filtros, y una calibración conservadora de QSV. La prueba de paneles de quince minutos conserva sus limitaciones; la validación con grabaciones reales y las comprobaciones nativas bloqueadas siguen pendientes.

## Entorno y método

- Windows 11 Pro for Workstations, Intel i5-12400, 12 procesadores lógicos, 7,78 GiB de RAM visible, Intel UHD Graphics 730; controlador 32.0.101.7088.
- Beru 1.6.46, Electron 35.7.5, Chromium 134.0.6998.205, renderer compilado con Vite 5.4.21. Se usó el proceso principal del repositorio, sin empaquetar, y Python del sistema para procesar. El ejecutable incluido estaba desactualizado según el diagnóstico de la aplicación; no se reconstruyó.
- Compilación independiente en una carpeta temporal, con credenciales Supabase vacías y perfiles de usuario aislados. No se usó la sesión del usuario. La compilación temporal añade una referencia al store exclusivamente para conducir los escenarios y genera sourcemaps; los archivos fuente y el build existente permanecen intactos.
- Clips sintéticos H.264, 1920 × 1080, 30 fps, 12 segundos, sin audio, 3.808.586 bytes por archivo. Los 120 archivos contienen el mismo clip con rutas distintas para ejercitar las cachés por ruta. La exportación usa dos clips recortados a cuatro segundos y un desenfoque de una región de 40 % × 40 %.
- Arranque: desde lanzar el proceso hasta encontrar `.app-shell` y completar dos callbacks de `requestAnimationFrame` con la ventana visible. Son latencias bajo instrumentación, no FCP, LCP ni un INP medido. El debugger y el control de visibilidad añaden coste.
- CPU y memoria de Electron: `app.getAppMetrics()` cada 250 ms. En la repetición de medios y exportación se incluyeron procesos hijos con un muestreador nativo de Windows, conservando sus tiempos de CPU al salir. Intervalo solicitado 50 ms; mediana observada 81 ms en la repetición. Procesos demasiado breves pueden escapar al muestreo.
- CPU total: tiempo de CPU acumulado dividido por duración y por 12 procesadores lógicos; 100 % corresponde a toda la máquina. Memoria: suma de working sets y, por separado, bytes privados. Los working sets pueden contar páginas compartidas varias veces; no incluyen toda la memoria gráfica. Se excluyeron procesos ajenos mediante la relación padre/hijo.
- Fluidez: intervalos de `requestAnimationFrame`, tareas largas, perfil CPU y contadores explícitos de video. Los fps de interfaz no son los fps del archivo de 30 fps. La observación añade un callback por fotograma.

El equipo tenía otras aplicaciones y procesos activos. Una lectura mostró solo 850 MiB de RAM física libre; el procesador registró 518–806 MiB disponibles en exportaciones. Los resultados incluyen esa presión de memoria. No se cerraron aplicaciones ajenas, se reinició Windows ni se vació su caché de archivos.

La semántica del muestreo de Electron se contrastó con su [documentación de CPUUsage](https://www.electronjs.org/docs/latest/api/structures/cpu-usage). La captura desde el inicio utilizó los [interruptores de trazado de Chromium](https://raw.githubusercontent.com/chromium/chromium/main/components/tracing/common/tracing_switches.cc).

## Mediciones

“Frío” significa proceso nuevo y perfil de Chromium nuevo; la caché del sistema operativo puede estar caliente. “Caliente” significa reabrir otro proceso con el perfil de la primera ejecución. No se midió un arranque inmediatamente posterior a reiniciar el equipo.

| Arranque           | Repeticiones | Mediana | Mínimo–máximo | `domComplete`, mediana desde navegación |
| ------------------ | -----------: | ------: | ------------: | --------------------------------------: |
| Perfil nuevo       |            3 |  881 ms |    722–967 ms |                                  387 ms |
| Perfil reutilizado |            5 |  800 ms |    770–960 ms |                                  258 ms |

La diferencia de 81 ms queda dentro de una variabilidad considerable; estas muestras no justifican atribuir una mejora estable a la caché. Las ocho ejecuciones registraron tareas largas de 94–293 ms en el arranque. En reposo, la mediana por ejecución de CPU de Electron fue 0,67–0,96 %, el working set agregado 375–477 MiB y los bytes privados 237–262 MiB.

| Carga o acción                              |                       Resultado | Alcance                                                                                                |
| ------------------------------------------- | ------------------------------: | ------------------------------------------------------------------------------------------------------ |
| Importar 24 clips con caché de medios vacía |                     4,56–5,11 s | Metadatos y todas las miniaturas; dos ejecuciones                                                      |
| Primer video listo para decodificar         |                          359 ms | Repetición de 24 clips; `readyState >= 2`, no primera imagen confirmada visualmente                    |
| Reimportar los mismos 24 clips              |                           89 ms | Cachés del proceso ya listas                                                                           |
| Importar 120 clips                          |                   12,80–14,81 s | 24 rutas ya estaban en caché; 96 eran nuevas                                                           |
| Solo metadatos, 24 clips                    |                   479 ms / 4 ms | Primera solicitud / repetición                                                                         |
| Solo miniaturas, 24 clips                   |                 2.901 ms / 6 ms | Primera solicitud / repetición                                                                         |
| Tira de 20 fotogramas                       |                     2,81–3,87 s | Dos fuentes nuevas y una repetición independiente                                                      |
| Ajustes hasta dos callbacks de pintura      |                 84 ms / 40,5 ms | Primera apertura / reapertura; el módulo ya se había cargado durante el arranque                       |
| Frame fuente mediante procesador            |            792–934 ms iniciales | Worker nuevo, dos ejecuciones                                                                          |
| Frame fuente con worker caliente            |                      230–351 ms | Diez solicitudes; medianas de 275 y 310 ms por ejecución                                               |
| Frame procesado con blur                    | 357 ms; siguientes 611–1.869 ms | Worker ya había recibido solicitudes automáticas de la UI; no es una comparación fría/caliente aislada |

La fila de 120 clips no representa 120 fallos de caché. Los tiempos de frames procesados incluyen competencia con las solicitudes automáticas del editor, por lo que no demuestran por sí solos el coste exclusivo del filtro.

| Escenario con medición nativa de hijos        | CPU media total aproximada | Working set máximo agregado | Bytes privados máximos |
| --------------------------------------------- | -------------------------: | --------------------------: | ---------------------: |
| Importar 24 clips                             |                     44,5 % |                   1.177 MiB |              1.284 MiB |
| Importar 120 clips, caché parcial             |                     48,8 % |                   1.195 MiB |              1.489 MiB |
| Generar tira de fotogramas                    |                      8,7 % |                     369 MiB |                507 MiB |
| Reproducción de fuente, 6 s                   |                      2,9 % |                     399 MiB |                523 MiB |
| Cinco frames fuente, worker caliente          |                     18,6 % |                     561 MiB |                689 MiB |
| Exportar dos clips, perfil fast               |                     30,6 % |                   1.040 MiB |              1.286 MiB |
| Exportar dos clips, balanced, ventana visible |                     22,3 % |                     812 MiB |              1.312 MiB |

Se observaron ocho procesos de medios simultáneos durante importación. Los máximos de memoria y las medias de CPU no necesariamente ocurren al mismo tiempo. El coste de generar cada tira también varía con la residencia de memoria; no se debe comparar su working set directamente con el de una ejecución anterior para inferir ahorro.

| Fluidez                                  | Resultado observado                                                                               |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Scroll de cola de 120 archivos           | 59,6 callbacks/s, p95 16,8 ms, sin intervalos mayores de 33,5 ms; 27–35 filas montadas            |
| Reproducción de fuente                   | 59,5–59,9 callbacks/s; una repetición registró 1 frame de video perdido de 187 acumulados         |
| Reproducción con un blur regional        | 59,7 callbacks/s, p95 16,8 ms, sin tareas largas; 0 frames perdidos de 184 acumulados             |
| Generación de tira                       | 43,9–57,3 callbacks/s, intervalos de hasta 467 ms en la repetición y tareas largas de hasta 80 ms |
| Importación de 24 clips                  | 51,2–52,4 callbacks/s; intervalos de hasta 233 ms y una tarea larga de 141–143 ms                 |
| Exportación balanced con ventana visible | 55,5 callbacks/s, p95 17,3 ms, 16 intervalos mayores de 33,5 ms y tareas largas de hasta 82 ms    |

Se exportaron dos clips por lote con Intel Quick Sync `h264_qsv`, dos workers, sin errores ni cancelaciones. El lote fast tardó 4,25 s; balanced tardó 5,62 s en una ejecución parcialmente oculta y 11,01 s en la confirmación visible. Los logs muestran 3,1 s por encoder en fast y 3,7–6,1 s en balanced; la latencia del lote incluye detección, preparación y otras tareas. La variación impide calcular una ventaja fiable entre perfiles. `ffprobe` confirmó las seis salidas: H.264, 1080p, 30 fps y cuatro segundos.

En la confirmación de exportación también se generaron 20 imágenes de la tira, con 1.146 ms acumulados en conversión del canvas. La prueba mide exportación más actividad de previsualización; no permite atribuir toda la irregularidad al encoder.

## Cuellos de botella y mejoras a evaluar

**Prioridad alta: extracción y codificación síncrona de la tira.** En `src/components/video-preview/useFilmstripFrames.js:59`, `canvas.toDataURL()` acumuló 599–681 ms por 20 imágenes: aproximadamente 30–34 ms por llamada. El perfil CPU independiente atribuyó 596 ms a `toDataURL`, frente a 6,9 ms instrumentados en `drawImage`. El hook hace 20 seeks secuenciales y actualiza estado después de cada imagen; la duración total de 2,8–3,9 s incluye la espera de decodificación, no solo conversión. Volver a una fuente aún en la caché de cuatro entradas no produjo nuevas conversiones y mantuvo unos 60 callbacks/s.

Evaluar extracción progresiva de menos muestras iniciales, conversión asíncrona con `toBlob`/URLs de objeto y publicación de resultados por grupos. Un worker con OffscreenCanvas es una alternativa más costosa y no elimina automáticamente el seek del elemento de video. Riesgos: duración de URLs, limpieza al cancelar, orden de resultados, caché invalidada por cambios del archivo y paridad visual. Antes de cambiar la arquitectura, medir por separado seek, conversión y actualización de React; comparar tiempo hasta primeras muestras y hasta tira completa. La evidencia no respalda empezar añadiendo `memo` por toda la interfaz.

**Prioridad alta: concurrencia de importación y miniaturas bajo presión de RAM.** `main/utils/media-task-pool.js` permite hasta ocho tareas según CPU lógica. `main/utils/thumbnail.js` inicia un FFmpeg por miniatura sin fijar explícitamente sus threads; metadatos y miniaturas comparten el pool. Solo miniaturas costó 2,9 s frente a 0,48 s de metadatos, y las cachés redujeron ambos a unos pocos milisegundos. La importación real llegó a 1,2 GiB de working set y retrasó la finalización de metadatos hasta 4,56 s aunque el primer video ya estaba listo a los 359 ms.

Evaluar prioridad para metadatos del video seleccionado y miniaturas visibles, generación del resto a demanda, una caché persistente pequeña invalidada por ruta/mtime y un límite de concurrencia consciente de memoria y resolución. La política de exportación ya calcula capacidad; conviene revisar si sus criterios pueden servir también para medios. Probar 2/4/8 tareas y límites de threads en condiciones idénticas antes de elegir. Menos concurrencia puede reducir memoria y mejorar interacción, pero aumentar el tiempo total de una importación. Una caché en disco requiere límite de tamaño y limpieza; no sustituye la validación del archivo.

**Prioridad media: carga inicial que incluye funciones cerradas.** La captura de solicitudes confirma 14 scripts locales durante el arranque: 1.071.069 bytes sin comprimir, equivalentes a 306.343 bytes gzip, más 192.011 bytes de CSS. Incluye SettingsModal, TableEditor, ExcelMappingModal, WatermarkModal, ShortcutsModal y módulos de mascotas aunque estén cerrados o desactivados. `App.jsx` y `BeruRoot.jsx` montan los componentes lazy incondicionalmente y sus componentes devuelven `null` después de cargar. `xlsx` sí quedó diferido y no se solicitó en el arranque.

El chunk principal mide aproximadamente 698 kB e incluye el SDK Supabase, Radix y VideoPreview. Los tamaños de módulos en la evidencia son previos a minificación y no deben sumarse como bytes finales. La traza de arranque instrumentada registró un callback React/Scheduler de 243 ms, que incluye 80,5 ms de actualización forzada de estilo/layout; son eventos anidados, no costes independientes. La traza añade sobrecarga y se usa para atribución, no para sustituir las ocho latencias iniciales.

Evaluar activar la carga de los paneles al primer uso y separar la entrada de autenticación del editor cuando corresponda. Preservar el estado que actualmente sobrevive al cerrar un panel; montar y desmontar indiscriminadamente podría perder ediciones. Diferir Supabase requiere mantener la resolución inicial de sesión y no mostrar el editor prematuramente. El ahorro de tamaño es demostrable en el grafo; el ahorro de tiempo todavía no se midió.

**Prioridad media: latencia de preview exacto y competencia con exportación.** El worker Python persiste, pero `python/processor.py` inicia FFmpeg por frame. Los frames fuente calientes todavía tardan 230–351 ms y cinco solicitudes utilizaron aproximadamente 18,6 % de CPU total. La UI ya tiene debounce, protección contra respuestas obsoletas y una cola que reemplaza solicitudes pendientes. Evaluar caché de frames por firma de archivo/operaciones/timestamp y coordinación con el trabajo de exportación antes de introducir un decoder persistente. El decoder persistente sería un cambio mayor: debe conservar seek, filtros temporales, timestamps y paridad con exportación. Esta auditoría no prueba una fuga ni justifica renderizar todos los gestos con FFmpeg.

La cola virtualizada, el loop de blur pausado y la reproducción simple no son prioridades de refactor según estos datos. Durante seis segundos de blur se hicieron 172 dibujos, próximos al límite de 30 fps del overlay, sin conversiones a data URL ni tareas largas.

## Memoria, límites y verificación

El heap JS medido por CDP fue de 6,45 MiB en reposo, llegó a 13,06 MiB en el escenario de blur y volvió a 6,56 MiB después de limpiar la cola y forzar GC para diagnóstico. El working set también descendió. Quedaron workers del preview y cachés acotadas; una prueba breve no demuestra ausencia de fugas durante horas, pero no se observó crecimiento retenido ilimitado del heap JS en este ciclo. Forzar GC fue una comprobación, no una propuesta de funcionamiento normal.

Las primeras muestras de procesos hijos con PowerShell/CIM tuvieron pausas de hasta 3,9 s. Sus cifras de CPU y memoria de medios se descartaron y se reemplazaron por el muestreo nativo. Se excluyeron asimismo los fps de la exportación que tuvo un cambio a `document.visibilityState === 'hidden'` y el cambio rápido entre ocho fuentes que no tenía registro de visibilidad. Los datos descartados siguen en los archivos temporales para transparencia. No se atribuyeron sus pausas como un fallo confirmado de la aplicación.

Pendiente para generalizar: instalador real con el procesador recompilado, autenticación con red lenta/offline, arranque tras reinicio, proyectos restaurados grandes, Excel grande, 4K/HEVC, varios overlays y filtros temporales, audio y sesiones prolongadas. No se midió memoria gráfica dedicada, latencia real de entrada INP ni calidad visual del resultado mediante una comparación de píxeles.

Los artefactos completos están en `C:/Users/HIDROAA/AppData/Local/Temp/beru-performance-audit-20260930`: lanzador, compilación, fixtures, logs, JSON por ejecución, `focused-filmstrip.cpuprofile`, `startup-trace.json`, métricas del sistema y videos exportados. El sistema puede limpiar esa carpeta temporal. La evidencia resumida junto a este informe conserva los resultados seleccionados y la atribución del perfil. No hubo subagentes, commits, push ni cambios de configuración persistente del usuario.

`npm run format:check` pasó para todo el repositorio. Se revisaron la sintaxis JSON, el enlace local a la evidencia y las rutas de código y artefactos citadas. No se ejecutaron lint ni suites de comportamiento porque no se cambió código del producto. Las exportaciones y escenarios anteriores son las verificaciones de ejecución de esta auditoría.

## Seguimiento: reducción de la conversión síncrona

Después de la auditoría, el usuario autorizó aplicar la primera mejora. En aquella versión, el hook de la tira capturaba un `ImageBitmap` y lo transfería al worker histórico `src/components/video-preview/filmstrip.worker.js`, posteriormente sustituido por la extracción actual de FFmpeg. El worker dibujaba en `OffscreenCanvas` y convertía a JPEG; el renderer leía el blob de forma asíncrona. Se mantenían las 20 muestras, altura de 64 píxeles, calidad 0,6, publicación progresiva, URLs de datos y caché de cuatro fuentes. No se necesitaron cambios de CSP ni URLs de objetos con un nuevo ciclo de revocación.

La cancelación aborta las esperas de eventos, termina el worker y descarga el video auxiliar. Un bitmap cuya captura termina después de cancelar se cierra. También se liberan el worker y el decoder al completar la tira o fallar; una tira cancelada no entra en la caché.

Se recompiló el renderer en carpetas temporales separadas. La comparación usó el build original conservado, los mismos clips 1080p del informe, cinco videos importados y todas sus miniaturas ya cargadas. Cada ejecución tuvo un perfil aislado, tres fuentes nuevas, una vuelta a una fuente cacheada y un cambio de fuente a los 150 ms. La ventana permaneció visible y al frente, sin cambios de visibilidad. No se ejecutaron suites durante estas mediciones.

La [evidencia del seguimiento](filmstrip-performance-2026-09-30.json) conserva las seis ejecuciones, métricas seleccionadas, atribución CPU, contadores de ciclo de vida y hashes del código final. La tabla compara las tres tiras de la última ejecución original con las tres de la ejecución final:

| Métrica por tira de 20 imágenes                                                                | Original, mediana | Worker, mediana |
| ---------------------------------------------------------------------------------------------- | ----------------: | --------------: |
| Trabajo síncrono medido de captura, dibujo, conversión, envío y lectura en el hilo de interfaz |          589,4 ms |         11,6 ms |
| Tiempo ocupado del hilo principal del renderer, `TaskDuration`                                 |          794,2 ms |        223,5 ms |
| Tiempo hasta completar la tira                                                                 |        2.642,5 ms |      2.669,9 ms |
| Fps de `requestAnimationFrame`                                                                 |             58,48 |           58,51 |

El trabajo síncrono medido baja aproximadamente un 98 %, con 9,1–14,6 ms en las tres tiras finales. Incluye `createImageBitmap`, `Worker.postMessage` y el inicio de `FileReader.readAsDataURL`, para no ocultar una transferencia de coste. No hubo dibujo de canvas ni `toDataURL` en el renderer final. El tiempo ocupado de su hilo principal baja aproximadamente un 72 %; el perfil original atribuye 569–602 ms a `toDataURL`, que desaparece del perfil final.

Esto libera el hilo de interfaz durante la conversión, pero no elimina el trabajo del worker y GPU. `TaskDuration` no mide el CPU de todos los threads. El tiempo total sigue alrededor de 2,7 segundos y los fps medios apenas cambian; no se acredita una mejora general de latencia de entrada, CPU total o memoria. El heap JS final fue de 6,60–8,60 MiB, frente a 7,37–8,48 MiB en la comparación original. Son muestras cortas bajo la presión de memoria ya descrita.

La primera apertura aún tiene variación de fluidez: el mayor intervalo de pintura fue de 99,9 ms en la confirmación final y 216,7 ms en la primera prueba del worker, frente a 83,4 ms en la confirmación original. No hubo tareas largas de al menos 50 ms durante las tiras finales. Esto no garantiza ausencia de pausas del compositor ni demuestra una mejora del primer fotograma. La vuelta a una tira cacheada no creó workers ni capturó imágenes y mantuvo aproximadamente 60 fps.

Se descartaron dos alternativas medidas: `canvas.toBlob` en el renderer todavía consumía 543–572 ms síncronos; `willReadFrequently` trasladó el bloqueo al dibujo y consumió 745–953 ms. Ninguna quedó en el código final. El worker emitido por Vite mide 370 bytes y se cargó desde el build local sin errores de consola ni CSP. Las imágenes visibles decodificaron como JPEG de 114 × 64 píxeles; se revisó también la captura de la timeline. La confirmación creó y terminó cinco workers, incluyendo los dos del cambio cancelado, y el último video completó sus 20 imágenes.

Las [cuatro pruebas nuevas](../tests/filmstrip-frames.test.jsx) cubren publicación progresiva y orden, reutilización de la caché, descarte de respuestas de una fuente cancelada, cierre de una captura que termina después de desmontar y fallo de carga del worker. El gate de `test-audit` identificó estos contratos observables y las regresiones de ciclo de vida que puede introducir el trabajo asíncrono. Las pruebas de trim existentes no ejercitan esa generación; se prueba el hook mediante un consumidor React, sin exports ni globals nuevos de producción. No son benchmarks ni pruebas de calidad visual del encoder: esa parte se verificó en Electron real.

Respecto del archivo local anterior conservado en el build de auditoría, el hook incorpora 62 líneas y elimina 21; el worker añade 15 líneas. Tests y soporte de tests añaden 168 líneas, sin modificar soporte compartido. Se revisó ese diff delimitado y se preservaron los cambios ajenos del checkout.

Validación de código a las 12:32, hora local: `npm run lint`, `npm run format:check` y `npm test` pasaron; 128 archivos y 826 tests JS. Las pruebas focalizadas de la tira y trim pasaron, siete tests. El build Vite y los escenarios de Electron pasaron; no se cambió Python ni se construyó el instalador. Los logs, builds, capturas, lanzadores y perfiles completos se conservan junto a los artefactos temporales originales, con prefijo `filmstrip-`. No hubo subagentes, commits ni publicaciones.

Al repetir el formato después de documentar los resultados, `npm run format:check` encontró problemas en dos archivos ajenos, ausentes del estado inicial: [delogo-render-core.js](../src/utils/delogo-render-core.js) y [delogo-render-reference.js](../tests/fixtures/delogo-render-reference.js). Sus tiempos de creación fueron 12:36:02 y 12:37:34, posteriores al log de formato correcto que terminó a las 12:32:51. Se conservaron sin modificar. La comprobación explícita de formato de los cinco archivos de este seguimiento pasó; no se presenta el formato global actual como aprobado.
