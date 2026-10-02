# Mediciones repetibles de rendimiento

La herramienta complementa las pruebas funcionales con una ejecución visible en Electron real. No cambia el build normal, no usa la sesión del usuario y no publica resultados. El punto de partida es la [auditoría del 30 de septiembre](performance-audit-2026-09-30.md).

## Ejecutar

Con las dependencias de desarrollo, FFmpeg, ffprobe y un procesador disponibles:

```sh
npm run perf:measure
npm run perf:measure -- --runs 1
npm run perf:measure -- --runs 5 --clips 120 --out C:/benchmarks
npm run perf:measure -- --runs 5 --startup-only
```

El valor por defecto es cinco repeticiones y 24 clips. `--runs` acepta 1–50; `--clips`, 2–120. `--startup-only` comprueba únicamente arranque y carga de paneles. `--out` es el directorio padre: cada invocación crea una carpeta nueva `beru-performance-*`, incluso si ya hay resultados anteriores. Sin esa opción se usa el directorio temporal del sistema. No se sobrescriben fixtures ni exportaciones anteriores.

Mantén la ventana visible. La herramienta la enfoca y la mantiene delante mientras mide; no ejecutes tests, otros benchmarks ni builds simultáneamente. El sistema operativo y las aplicaciones ajenas siguen afectando las cifras. Los escenarios visibles se invalidan si se oculta la ventana; una muestra lenta con memoria baja se conserva. El timeout por proceso es de tres minutos, incluyendo la preparación y la limpieza. El runner guarda logs y resultados parciales, cancela el procesamiento y termina el árbol de su propio proceso en Windows si vence el límite externo.

La herramienta usa el proceso principal y el preload reales del checkout, junto con un renderer compilado aparte. Un plugin exclusivo del benchmark expone el store para conducir acciones existentes; no añade globals al código fuente de la aplicación. Supabase queda sin configurar en ese build, por lo que no se mide autenticación ni se usan credenciales del usuario. `userData` y `sessionData` apuntan a perfiles exclusivos. La selección de Python o del ejecutable incluido sigue la política de desarrollo de Beru; el informe registra cuál se utilizó. Si el procesador incluido está desactualizado, la advertencia no significa que se haya usado: consulta `binaries.processor.mode`.

## Escenarios y límites

Cada repetición ejecuta estos pasos en serie:

1. **Arranque con perfil nuevo y reutilizado.** Son dos procesos independientes con el mismo perfil aislado. Se mide desde el lanzamiento hasta `.app-shell` y dos callbacks de pintura. Después se observan las solicitudes durante dos segundos para detectar imports diferidos al reposo. “Nuevo” no significa caché de disco fría ni reinicio del sistema. Un tercer perfil independiente conduce los escenarios de medios y no contamina el arranque reutilizado con una sesión de videos restaurada.
2. **Importación fría y cacheada.** Se generan clips H.264 sintéticos, 1080p, 30 fps, 12 segundos y sin audio. Los archivos tienen contenido idéntico y rutas distintas. Se usa `resolveDroppedPaths` y `addVideos`, esperando metadatos y todas las miniaturas. Se limpia la cola y se repiten las mismas rutas para ejercitar las cachés del proceso. La primera importación incluye la actividad automática de preview/tira que active la interfaz.
3. **Preview exacto.** Se solicita y decodifica un frame fuente, luego tres timestamps nuevos con el worker ya usado, y se repite el primer timestamp para medir la caché. También se solicitan tres frames procesados con un blur de 40 % × 40 %. Las latencias incluyen IPC, procesamiento y decodificación de la imagen; no son INP ni medidas aisladas del filtro. El editor permanece activo, así que puede competir por el worker. La primera solicitud explícita no garantiza que ningún consumidor automático haya iniciado antes el worker.
4. **Exportación con preview simultáneo.** Se importan dos clips, se aplica un blur de 40 % × 40 %, se recortan a cuatro segundos y se pide el perfil balanced con dos workers. Durante la reproducción se lanza el lote mediante `processAll` y se solicita un nuevo frame fuente con el lote activo. Se registra ese solapamiento, el máximo de jobs activos observado por el store y los frames de video perdidos. La capacidad efectiva puede reducir la concurrencia bajo presión de memoria; `requestedWorkers` no equivale a concurrencia garantizada. Se exigen el evento de finalización, dos estados `done` y dos archivos H.264 de 1920 × 1080 y unos cuatro segundos verificados con ffprobe.

No se comparan píxeles, no se mide VRAM, no se prueba un instalador y no se vacían cachés del sistema. Los clips repetidos no representan diversidad de contenido, HEVC, 4K, audio ni proyectos grandes. Para ampliar la cobertura hay que añadir escenarios explícitos, no interpretar estas cifras como prueba de esos casos.

## Guarda de paneles cerrados

En cada arranque vacío se cruzan las solicitudes reales de scripts, capturadas por CDP y Resource Timing, con los módulos de los chunks emitidos por Rollup. No se depende del nombre del chunk: también falla si un panel termina dentro del archivo principal. Se vigilan atajos, tabla, mapeo Excel, marca de agua, ajustes, sus pestañas/editor de temas, inspector/lista de capas y los componentes diferidos de mascotas. Los wrappers lazy y el teclado global de mascotas sí pueden formar parte del arranque.

Una violación queda en `panelViolations`, conserva el archivo y el módulo causante y hace fallar el comando. Los errores de scripts, excepciones de ejecución, timeouts, outputs inválidos o cambios de fuentes durante la medición también impiden declarar una serie válida. No se imponen umbrales de milisegundos arbitrarios: primero hay que construir una referencia comparable por equipo y configuración.

## Leer los resultados

La consola muestra el directorio y las latencias por escenario. `report.json` conserva opciones, entorno, commit, estado sucio, hashes de fuentes y lockfile, chunks finales, versiones de Electron/Chromium/Node, rutas y versiones de FFmpeg/ffprobe, selección/versión del procesador e intérprete y hashes de ejecutables accesibles. Un procesador empaquetado sin versión consultable se identifica por modo, ruta y hash, no por una versión inferida del checkout.

Los archivos `<repetición>-<escenario>.json` conservan solicitudes, muestras, intervalos de pintura, acciones y validaciones de salida; los `.log` conservan mensajes del proceso principal y del procesador. Se mantienen builds, perfiles, clips y exportaciones para investigar fallos. Estos artefactos pueden contener rutas locales: revísalos antes de compartirlos. Borra solamente la carpeta de artefactos indicada cuando ya no la necesites; no forma parte del repositorio.

`summary` separa los escenarios y calcula `count`, mínimo, mediana, p90, p95, p99 y máximo por interpolación lineal sobre las muestras ordenadas. Las latencias de fases se agregan entre repeticiones; `previewRequestMs` agrupa las solicitudes individuales de preview y `frameIntervalMs`, los callbacks de pintura de las ejecuciones válidas. El tamaño de muestra queda explícito: cinco repeticiones no convierten p99 en una estimación estable de la cola de producción. Una ejecución fallida conserva sus datos crudos, pero no contribuye al resumen de series válidas.

La memoria física disponible se lee mediante `os.freemem()` y el working set de Electron mediante `app.getAppMetrics()`, aproximadamente cada 250 ms, además de los extremos de cada fase. El informe resume el mínimo disponible y el máximo working set **muestreado** por repetición. Los working sets pueden contar páginas compartidas y excluyen FFmpeg/Python externos; no se presentan como memoria total del árbol de procesamiento. `rendererHeapEndBytes` es una captura al final de la fase, no su máximo. Los intervalos reales del muestreo están en `samples[].atMs`; picos entre muestras pueden escapar. El arranque incluye la latencia desde lanzar el proceso, pero el muestreo de memoria empieza al crear la ventana.

## Verificación de la herramienta

Las pruebas de [performance-report](../tests/performance-report.test.js) protegen el cálculo de percentiles, la separación de escenarios, la exclusión de ejecuciones inválidas y la detección de un panel incluso dentro del chunk principal. Estos contratos no los cubren las pruebas funcionales de apertura de modales; no se añadieron seams al producto para probarlos. El benchmark nativo es opt-in y no forma parte de `npm test`, para evitar resultados dependientes de GPU, foco y presión de memoria en CI.

### Estado de la validación local

La implementación se verificó en el checkout de Windows entre el 30 de septiembre y el 1 de octubre de 2026. Pasaron las tres pruebas nuevas, lint, formato y la compilación aislada de Vite. El gate compartido del mismo checkout incluye esas pruebas: 158 archivos y 1.084 casos JS pasaron; dos archivos de integración no completaron su ejecución porque FFmpeg no pudo crear sus fixtures. La suite Python compartida pasó sus cinco archivos iniciales y se detuvo en `test_delogo.py` al crear una imagen mediante FFmpeg. No se modificaron esas pruebas para hacerlas pasar.

Un piloto anterior completó los arranques nuevo y reutilizado, con cuatro scripts iniciales y cero violaciones de paneles. No se usa como referencia de rendimiento final: otras mediciones estaban activas en el equipo y faltaban los últimos cambios del arnés. La serie integral final se detuvo antes de medir, al generar el fixture: `Permission denied`, salida nativa `4294967283` de FFmpeg. La comprobación final de arranque también quedó bloqueada: Electron terminó con `2147483651` sin generar su resultado; ejecutar solamente `electron.exe --version`, sin la entrada del arnés, reprodujo el mismo código.

Se aisló el fallo de FFmpeg fuera del arnés: Node pudo escribir en los mismos directorios y FFmpeg pudo codificar hacia stdout, pero la salida directa a archivo falló con rutas nuevas o precreadas, tanto en Temp como en `.capy/work`. Otro hilo del mismo equipo reprodujo esa restricción. No se atribuye ese fallo a la implementación ni se declara validada la serie de importación/preview/exportación. El control negativo de inclusión de paneles está cubierto por la prueba del grafo de chunks; su ejecución nativa final quedó pendiente por el fallo de Electron.

Los logs de esta implementación están en `C:/Users/HIDROAA/.capy/work/beru-perf-automation/`; los gates compartidos, en `C:/Users/HIDROAA/.capy/work/beru-memory-20260930/{lint-final,format-final,tests-final,python-final}.log`. Los informes de error se conservaron en `C:/Users/HIDROAA/AppData/Local/Temp/beru-performance-3ODfjA/report.json` y `C:/Users/HIDROAA/AppData/Local/Temp/beru-performance-9uMlho/report.json`. Para completar la validación, hay que restaurar la ejecución/escritura nativa en el equipo y repetir `npm run perf:measure -- --runs 3`; hasta entonces no hay medianas finales aceptadas de esos escenarios.
