# Caché de fotogramas de preview exacta — 2026-09-30

Seguimiento de la [auditoría de rendimiento](performance-audit-2026-09-30.md). La [evidencia JSON](preview-frame-cache-performance-2026-09-30.json) conserva las seis secuencias de medición, hashes de JPEG, comprobaciones IPC y hashes de los archivos finales.

Las solicitudes repetidas bajaron de una mediana de 370,57 ms a 0,19 ms en el cliente del proceso principal. En 54 solicitudes por variante, las enviadas al worker pasaron de 54 a nueve: las otras 45 reutilizaron el fotograma. El primer render de una combinación nueva sigue necesitando FFmpeg. Estas cifras no representan tiempo hasta pintar en pantalla ni una mejora general del arranque.

## Causa y decisión

El worker Python permanece abierto, pero inicia FFmpeg para renderizar cada fotograma. El renderer conservaba la última imagen y su firma; volver a un timestamp o configuración anteriores requería otra solicitud. La protección contra respuestas obsoletas y el reemplazo de solicitudes pendientes ya existían.

Se añadió [preview-frame-cache](../main/utils/preview-frame-cache.js) delante del cliente existente y del pool de medios. Ambos handlers de preview lo usan después de validar permisos y sanear las rutas. Un acierto evita esperar por admisión y no envía trabajo al worker. Los fallos de caché mantienen la prioridad interactiva y las reglas actuales de admisión durante una exportación.

## Política de caché

- LRU compartida entre frames fuente y procesados, con hasta 32 entradas y 32 MiB estimados. El presupuesto cuenta el JSON de la respuesta como UTF-16 y su clave; no incluye memoria del worker, del renderer ni imágenes decodificadas por Chromium.
- La clave contiene una firma SHA-256 del payload completo y los metadatos del video y las imágenes referenciadas: ruta, dispositivo, inode, tamaño, modificación y cambio. Incluye imágenes de operaciones, imágenes de delogo y marca de agua.
- El timestamp se conserva exactamente, sin agrupar tiempos cercanos. Operaciones, texto, dimensiones y parámetros de watermark forman parte del payload. El flag `source_only` separa la imagen fuente de la procesada.
- Cada lectura consulta los archivos. Si uno desaparece o no puede consultarse, se evita la caché y se conserva la ruta normal de validación/render. Antes de guardar un resultado se vuelve a comprobar su firma.
- Solicitudes idénticas en curso comparten el resultado. Solo se almacenan respuestas satisfactorias con imagen; errores, cancelaciones y respuestas sin imagen pueden reintentarse.
- La caché vive en memoria durante el proceso. Al disponer el preview se limpian las imágenes y las solicitudes compartidas. Una solicitud todavía esperando admisión no inicia otro worker después de disponerlo; una respuesta tardía no repuebla la caché.

El cliente y el worker existentes conservan su protocolo, generación de JPEG, filtros, seek y cola de reemplazo. La disposición de la caché se integra en los mismos puntos de cierre y recuperación fatal de `main/main.js`.

## Medición nativa

Se ejecutaron tres procesos Electron independientes por variante, con perfiles aislados y Python del sistema, en el equipo de la auditoría: Windows 11, i5-12400, 7,78 GiB de RAM y Electron 35.7.5. Se usó el clip sintético H.264 1080p de doce segundos y se obtuvieron previews JPEG de 1280 × 720. Cada proceso renderizó tres estados —fuente, blur y otro timestamp— y repitió cada uno cinco veces.

La referencia llama al cliente original dentro del mismo pool; la variante final llama al servicio cacheado. Se mide desde invocar el cliente del proceso principal hasta resolver su promesa, incluyendo la consulta de archivos y el pool. Un contador en la escritura al worker identifica renders evitados. Los hashes SHA-256 de los JPEG coinciden entre variantes y entre todas las repeticiones de cada estado.

| Solicitud repetida, 15 muestras por fila | Mediana anterior | Mediana con caché |
| ---------------------------------------- | ---------------: | ----------------: |
| Frame fuente                             |        248,88 ms |           0,19 ms |
| Frame con blur                           |        433,09 ms |           0,19 ms |
| Frame en otro timestamp                  |        332,19 ms |           0,15 ms |
| Conjunto, 45 repeticiones                |        370,57 ms |           0,19 ms |

Las repeticiones anteriores abarcaron 200–957 ms; los aciertos finales, 0,06–0,47 ms. Dos solicitudes simultáneas idénticas a un timestamp nuevo produjeron dos renders en la referencia y uno en el servicio final, con el mismo JPEG para ambos consumidores.

También se ocupó deliberadamente el pool con tareas retenidas durante un segundo. Un frame ya cacheado resolvió en 0,12–0,43 ms sin enviar trabajo al worker. La referencia esperó la liberación y volvió a renderizar. Es una comprobación de admisión, no un benchmark de exportación real.

No se ejecutaron suites durante las mediciones. Otras aplicaciones permanecieron activas; las lecturas de RAM disponible y las métricas del proceso principal quedan en el JSON. Los primeros renders tuvieron variación considerable, por lo que no se atribuye a la caché una mejora del render nuevo, CPU total o memoria agregada de Beru.

## Comprobación por IPC

Se verificaron doce acciones con Electron, los handlers y path security reales, el preload de producción y un renderer temporal aislado. Las once respuestas con imagen se decodificaron correctamente. Se comprobó reutilización, separación de fuente/procesado, cambio de filtro, vuelta a una configuración anterior, sustitución de la marca de agua en la misma ruta, sustitución del video y rechazo después de borrar el archivo.

Los cinco aciertos finales no enviaron solicitudes al worker y tardaron 1,24–3,67 ms por IPC. La ventana del arnés estaba oculta: esas observaciones comprueban transporte y contenido, no pintura visible, INP ni fluidez. Las primeras pasadas, anteriores a la integración final de los dos métodos del cliente, se conservaron en el directorio de artefactos; mostraron más variación de latencia. El fixture recibió una CSP antes de la pasada aceptada, que no registró errores de consola.

## Pruebas y alcance

Las veinte pruebas nuevas del [servicio de caché](../tests/preview-frame-cache.test.js) protegen reutilización sin admitir otra tarea, solicitudes concurrentes, diferencias de firma, cambios y desaparición de archivos, separación fuente/procesado, reintentos, expulsión por cantidad y presupuesto, disposición y permisos IPC después de cachear.

El gate de autoría de `test-audit` identificó como regresiones plausibles devolver una imagen vieja, conservar respuestas fallidas, admitir renders duplicados, crecimiento sin límite o repoblar la caché al cerrar. Las pruebas del worker y de respuestas obsoletas no cubrían esta política. Se ejercita el servicio usado por producción, con archivos temporales reales y el worker simulado; no se exportan claves, mapas o estadísticas para tests. Las comprobaciones nativas verifican el contenido JPEG y la ruta real del worker.

Respecto de las copias guardadas al empezar, producción añade 111 líneas y elimina seis en tres archivos. El test nuevo contiene 211 líneas; no se cambia soporte compartido. Se conservan los cambios ajenos del checkout. No se modifica Python, la configuración del build ni el renderer.

Las pruebas focalizadas finales pasaron: 61 casos en siete archivos, incluidos seek/paridad de filtros temporales y descarte de respuestas obsoletas. La primera suite completa pasó 1.082 casos y la repetición final pasó 1.055; ambas fallaron los mismos cuatro casos en `tests/excel-import-action.test.js`. El checkout tuvo cambios concurrentes y la repetición final incluyó 151 archivos. Las expectativas de `message` y códigos de error no coinciden con la importación actual de Excel. Esos cuatro fallos se reprodujeron en una copia temporal con `src/`, `shared/` y ese test, sin directorio `main/` ni test de caché. Se conservaron sin editar por ser ajenos a este cambio.

`npm run lint` pasó. El formato de los seis archivos de esta tarea pasó; `npm run format:check` global señala tres archivos ajenos: `src/stores/slices/batchSlice.js`, `src/stores/slices/projectSlice.js` y `src/utils/types.js`. Se conservan sin reformatear. Se revisaron el diff delimitado contra las copias iniciales, `git diff --check`, hashes, enlaces y sintaxis JSON. La evidencia registra los logs finales y la reproducción de línea base; no se declara la suite ni el formato global en verde.

No se construyó un instalador ni se cambió el procesador incluido. La validación usa Python del sistema; las suites JS incluyen los casos nativos de preview, pero no sustituyen la matriz de medios 4K/HEVC ni una sesión prolongada. La caché es de respuestas JPEG, no de decoders persistentes ni de fotogramas preparados para reproducción continua.

Los arneses, perfiles, copias iniciales y logs se conservan en `C:/Users/HIDROAA/AppData/Local/Temp/beru-performance-audit-20260930/preview-cache`. No hubo subagentes, commits ni publicaciones.
