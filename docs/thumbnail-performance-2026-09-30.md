# Miniaturas visibles y admisión según memoria

Fecha: 2026-09-30. Seguimiento de la [auditoría de rendimiento](performance-audit-2026-09-30.md). Datos, trazas de finalización, hashes y pasadas descartadas: [thumbnail-performance-2026-09-30.json](thumbnail-performance-2026-09-30.json).

La cola ahora atiende primero el video seleccionado, después las miniaturas visibles, los metadatos y finalmente las miniaturas de fondo. En dos pasadas nativas, las filas 89–107 recibieron sus imágenes en 5,1–6,1 s desde la importación; la política anterior tardó 18,8 s. El pico de memoria residente del árbol de procesos pasó de 1.406 MiB a 635–655 MiB. Son observaciones de este equipo, con RAM disponible variable y cambios concurrentes en el checkout, sin atribución causal aislada ni un porcentaje universal de mejora.

## Evidencia y decisión

El pool anterior admitía hasta ocho tareas según CPU, sin consultar RAM. Los lotes de fondo de doce imágenes esperaban a que terminara el lote completo antes de publicarlo y no conocían la visibilidad de las filas. Seleccionar un video ya tenía prioridad, pero desplazarse a una fila lejana no promovía su miniatura.

Antes de editar, se compararon límites de dos, cuatro y ocho extracciones de 24 clips. FFmpeg con hilos automáticos alcanzó unos 146 MiB de memoria privada por proceso; con dos hilos de decodificación y uno de filtros alcanzó unos 64 MiB. La disponibilidad inicial de RAM varió entre 181 y 1.358 MiB durante esas pruebas. Esa variación impide interpretar sus tiempos como una comparación controlada; el consumo por proceso respaldó limitar los hilos y estimar conservadoramente el coste de admisión de cada miniatura.

Se conservaron las siguientes decisiones:

- `QueueSidebar` observa las filas dentro del contenedor de scroll y un margen de 98 px para anticipar aproximadamente dos filas. Conserva la virtualización y promueve el trabajo solicitado por la zona más reciente.
- Las solicitudes se deduplican por ruta, modificación del archivo y ancho. Promover una extracción pendiente cambia su prioridad; no inicia otro FFmpeg. Los aciertos de caché no ocupan el pool.
- El pool reserva 512 MiB para la aplicación y usa el 80 % del resto como presupuesto estimado. Cada miniatura reserva 192 MiB y una consulta rápida de metadatos reserva 32 MiB. El presupuesto combina una instantánea inicial con la RAM libre actual para evitar admitir ocho procesos antes de que se materialice su memoria.
- La admisión sigue limitada a ocho tareas y a dos durante una exportación. Con RAM insuficiente o una lectura no válida, permite una tarea para mantener progreso. Los procesos activos terminan normalmente; se frena la admisión siguiente.
- El trabajo ligero puede ocupar presupuesto que no alcanza para otra miniatura. Los metadatos tienen prioridad sobre el fondo para evitar que toda la importación espere a decodificaciones que el usuario aún no ve.
- El fondo usa lotes de cuatro, con dos lotes pendientes como máximo. Los resultados se asocian por ruta y se descartan al vaciar la cola, incluido el caso de reimportar la misma ruta.

Una primera variante que asignaba 192 MiB también a los metadatos los retrasó a 22,3 s. Otra variante ponderada, pero sin prioridad propia de metadatos, tardó hasta 17,3 s en completarlos. Ambas se descartaron. La versión retenida separa su coste y su prioridad.

## Medición nativa

Windows, Intel Core i5-12400, doce procesadores lógicos, 7,78 GiB de RAM, UHD Graphics 730 y Electron 35.7.5. Se importaron 120 rutas distintas con contenido H.264 idéntico: 1920×1080, 30 fps, doce segundos, sin audio y 3.808.586 bytes por archivo. Se seleccionó el primer video y se desplazó la lista hacia la fila 90.

Se usaron perfiles de Electron aislados, caché de miniaturas inicialmente vacía y un renderer de producción temporal con autenticación sin configurar. La caché de archivos de Windows estaba caliente. Se midieron marcas del store, CDP, `requestAnimationFrame`, tareas largas y procesos nativos del árbol de esta ejecución. No se incluyeron otras aplicaciones en los agregados de CPU o memoria.

| Medida                                            | Política anterior | Versión retenida, pasada 1 | Versión retenida, pasada 2 |
| ------------------------------------------------- | ----------------: | -------------------------: | -------------------------: |
| RAM libre al comenzar                             |           967 MiB |                    876 MiB |                    751 MiB |
| RAM libre mínima observada                        |            38 MiB |                    652 MiB |                    629 MiB |
| Imágenes de las filas 89–107 desde importación    |           18,75 s |                     5,12 s |                     6,10 s |
| Espera de toda la zona visible después del scroll |           11,44 s |                     3,63 s |                     4,69 s |
| Las 120 miniaturas                                |           18,77 s |                    12,72 s |                    17,07 s |
| Metadatos de los 120 videos                       |            3,51 s |                     2,59 s |                     5,55 s |
| Pico residente, Electron y descendientes          |         1.406 MiB |                    635 MiB |                    655 MiB |
| Pico de memoria privada, árbol completo           |         1.559 MiB |                    579 MiB |                    549 MiB |
| Pico privado por FFmpeg                           |         146,5 MiB |                   63,6 MiB |                   63,6 MiB |
| CPU acumulada muestreada del árbol                |    99,47 s de CPU |             42,06 s de CPU |             35,38 s de CPU |
| CPU media aproximada, normalizada a doce CPU      |            44,1 % |                     27,6 % |                     17,3 % |
| Intervalo entre frames p99                        |           33,2 ms |                    16,9 ms |                    16,9 ms |
| Mayor intervalo entre frames                      |          2.433 ms |                     133 ms |                      83 ms |
| Mayor tarea larga                                 |          3.453 ms |                     112 ms |                     100 ms |

La zona visible de la referencia contenía las filas 89–107; las dos pasadas nuevas contenían 89–109. Por eso se calcula también la misma cohorte 89–107 usando la traza del store. El scroll se intentó repetidamente hasta llegar al destino porque el espaciador virtual existente puede encogerse dentro del layout flex. Ese layout no se modificó.

En las tres pasadas válidas se completaron las 120 miniaturas con exactamente un proceso de extracción por ruta, pese a solicitudes superpuestas de selección, visibilidad y lotes. Las imágenes visibles tenían dimensiones válidas y no hubo errores de consola. Se revisó visualmente la captura final. La traza muestra miniaturas del final de la cola terminando antes que numerosos archivos anteriores, confirmando la promoción efectiva a través de IPC.

Otra pasada de la referencia terminó con la ventana oculta; se excluyó de la comparación. Tampoco se comparó una pasada inicial que alcanzó una zona de scroll diferente. Los registros descartados permanecen identificados en el JSON.

## Verificación y alcance

Las pruebas focalizadas pasaron: cinco archivos, 43 casos. Se ejercitaron la reducción y recuperación de admisión por RAM, el trabajo ligero junto a una extracción pesada, la promoción sin duplicados y el orden seleccionado/visible/metadatos/fondo. En React y Zustand se comprobó que una fila visible recibe su imagen mientras el lote de fondo sigue pendiente, que quitar una fila anterior no desasocia el resultado y que vaciar y reimportar no acepta respuestas antiguas. Los dos tests previos del pool solo verificaban el límite fijo y la reserva durante exportación; no cubrían esos contratos. No se añadió una API de producción exclusivamente para estas pruebas.

La primera ejecución de `npm run lint` pasó. ESLint y Prettier focalizados en los archivos del alcance también pasaron. El build temporal de Vite pasó con el aviso existente sobre chunks mayores de 500 kB. `git diff --check` pasó para los archivos del alcance.

El gate global no quedó verde:

- `npm test`: 143 archivos y 1.037 casos pasaron; dos casos fallaron en `tests/video-probe-output-limit.test.js`, por listeners de stdout que permanecen después de exceder la salida o vencer el timeout. Se reprodujeron aisladamente: dos fallos y un caso correcto. Importan `probeVideoFile` de `main/videoProbe.js` directamente y recorren `main/utils/run-captured.js`; no llaman al pool ni al extractor de miniaturas. Esos módulos y ese test pertenecen a cambios concurrentes ajenos a esta implementación y se conservaron.
- La repetición de `npm run lint` a las 15:54 detectó cinco errores en el nuevo archivo ajeno `scan-comments.mjs`: una variable sin usar y cuatro referencias a `console` sin declarar. No se editó ese archivo.
- `npm run format:check`: señaló inicialmente siete archivos ajenos al alcance y nueve en la repetición de las 15:54: cuatro informes en `docs/audits/2026-09-30-thermo-nuclear/`, `main/handlers/petdex.js`, `main/utils/preview-frame.js`, `main/utils/processor-spawn.js`, `scan-comments.mjs` y `scripts/build-processor.mjs`. Los nombres exactos quedan en el JSON. No se reformatearon cambios ajenos. El formato de los archivos de esta implementación pasó.

El diff de los archivos de producción involucrados está mezclado con refactors concurrentes: 639 líneas añadidas y 361 eliminadas respecto a Git HEAD. El archivo compartido de pruebas del pool registra 251 añadidas y dos eliminadas, además de 134 líneas en el nuevo archivo de pruebas de prioridad. Estas cifras separan producción y tests, pero no representan autoría exclusiva ni un indicador de calidad. Se preservaron las modificaciones de preload, la centralización de IPC, el factory del pool y la extracción de filmstrip introducidas por otros cambios.

No se modificó Python ni se probó un instalador empaquetado. Los costes de RAM son estimaciones de admisión, no un límite físico garantizado; falta perfilar otros codecs, 4K y tareas que crean varios procesos. El muestreador puede perder procesos muy breves, de modo que las cifras de CPU son aproximadas. La presión de RAM puede aumentar los tiempos de fondo y de metadatos. Las dos pasadas retenidas permiten verificar este escenario, sin demostrar rendimiento universal ni aislar todas las contribuciones de un checkout concurrente.

Los artefactos nativos completos, capturas y arneses temporales están en `C:/Users/HIDROAA/AppData/Local/Temp/beru-performance-audit-20260930`, con prefijos `thumbnail-ui-*`, `thumbnail-limit-*` y `thumbnail-*`. El JSON del repositorio conserva los resultados resumidos, las trazas de las 120 imágenes, los hashes de fuente y las razones de exclusión.
