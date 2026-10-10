# Auditoría de código muerto

El objetivo es reducir código sin cambiar comportamiento observable. La ausencia
de referencias estáticas es una pista, no una prueba de que algo pueda borrarse.

## Procedimiento

1. Leer `AGENTS.md`, `git status`, `git diff` y `git diff --cached`. Conservar los
   cambios previos y delimitar los archivos autorizados.
2. Buscar nombres completos y prefijos en fuentes, tests, scripts, configuración
   y recursos. Incluir archivos ocultos y scripts versionados aunque coincidan
   con `.gitignore`; excluir binarios y salidas generadas de la evidencia de uso.
3. Clasificar cada candidato: alta (eliminación demostrablemente inocua), media
   (posibles consumidores indirectos) o baja (requiere cambiar diseño o lógica).
4. Reportar archivo, línea previa, evidencia y motivo antes de editar. Aplicar
   solo alta confianza, en rondas pequeñas. No borrar archivos ni dependencias
   únicamente por no encontrar imports.
5. Ejecutar después de cada ronda `npm run lint`, `npm run format:check` y
   `npm test`; también `npm run test:python` cuando se modifique Python. Conservar
   la salida real y distinguir tests omitidos de tests aprobados.

## Falsos positivos de Beru

- Electron conecta handlers mediante strings: comprobar main, preload, renderer,
  protocolos, eventos e imports dinámicos antes de tocar símbolos o archivos.
- Python conserva reexports en `processor.py` usados por tests y monkeypatching;
  revisar también PyInstaller, hidden imports y atributos consumidos por ctypes.
- Claves i18n, variantes CSS y clases Tailwind pueden construirse dinámicamente.
  Buscar prefijos, interpolaciones, `classList`, atributos y configuración de
  contenido. En selectores agrupados, no borrar reglas que contengan una clase viva.
- Un selector Zustand puede existir para provocar renders, aunque no se lea su
  resultado local. Quitar una suscripción puede modificar comportamiento.
- Las dependencias de hooks controlan cuándo se ejecuta lógica. Un aviso de
  ESLint no autoriza a cambiar reinicios, listeners o invalidación de cachés.
- Parámetros posicionales y exports pueden ser contratos aunque parezcan sin uso.
- Dependencias pueden servir a CLI, build, empaquetado o imports con efectos.

## Conservados en auditorías previas

Candidatos revisados en la ronda del 2026-09-04 y mantenidos por confianza media;
tratarlos como punto de partida, no como lista para borrar.

| Archivo                                                                                 | Motivo para conservar                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/components/Header.jsx`                                                             | El efecto de capacidad lee `get`; revisar estabilidad del getter y debounce antes de cambiar dependencias.                                                                                             |
| `src/components/TableEditor.jsx`                                                        | Añadir `queue` al efecto podría reiniciar tiempo y reproducción al editar la cola.                                                                                                                     |
| `src/components/TextOverlay.jsx`                                                        | Revisar `screen` y `scaleY` con pruebas de autoajuste y medidas; añadirlos cambia cuándo se mide.                                                                                                      |
| `src/components/VideoPreview.jsx`                                                       | Añadir selección o duración puede volver a limpiar regiones o reiniciar preview, reproducción y zoom.                                                                                                  |
| `src/components/video-preview/useZoomPan.js`                                            | `videoRef` es estable en el consumidor actual; no cambiar el contrato para referencias reemplazables dentro de una limpieza.                                                                           |
| `src/features/pets/settings/PetdexPanel.jsx`                                            | `getGalleryPets()` lee el store indirectamente. `petInstalled` y `petManifestLoading` invalidan el memo y no son código muerto.                                                                        |
| `src/stores/slices/watermarkSlice.js`, `src/utils/video-utils.js`                       | Mantener parámetros posicionales aunque no se lean.                                                                                                                                                    |
| `python/processor.py`                                                                   | Mantener los reexports usados como superficie de compatibilidad por tests.                                                                                                                             |
| `src/utils/session-persist.js`, `main/processing-run.js`, `main/utils/beru-protocol.js` | `resetSessionWriteCache`, `invalidateBeruStatCache`, `AUTO_TARGET_WORKERS`, `getIsProcessing` y `PROCESSING_LOCK_MAX_MS` son seams intencionales vivos (estado de sesión, runs y protocolo).           |
| `package.json`                                                                          | Revisar herramientas CLI y empaquetado además de imports del renderer. `js-yaml`, `@electron/asar` y `shadcn` tienen consumidores o configuración propia; no son candidatos demostrados para eliminar. |
| `src/index.css`, `src/features/pets/pets.css`                                           | Candidatos adicionales requieren revisar selectores agrupados, variantes y ambas ventanas de Electron.                                                                                                 |
| `tests/audit-config.test.js`                                                            | Verifica contratos de configuración, versiones, changelog y release. Conservar estas guardas; no equivalen a una prueba E2E de Electron.                                                               |

Los avisos React de `act(...)` requieren aislar las actualizaciones asíncronas en
los tests que los generan; no silenciar `console.error` globalmente para ocultarlos.

## Seguimiento del 2026-10-07

La revisión de las incertidumbres conservadas mantiene comportamiento e interfaces.
No se han eliminado canales IPC, reexports de Python, dependencias ni estilos.

| Área                             | Evidencia y decisión                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preview de Excel                 | `ExcelMappingModal.jsx` usa `rowIndexById` dentro de un memo. Se declara esa dependencia explícitamente; sus entradas ya invalidaban el preview. `tests/excel-mapping-modal.test.jsx` comprueba matches tras reemplazar filas y cambiar la columna ID.                                                                                                                                             |
| Reproducción del editor de tabla | `tests/table-editor.test.jsx` comprueba que editar texto del video enfocado conserva reproducción y tiempo. Se mantiene el reset dependiente del índice, sin añadir `queue`.                                                                                                                                                                                                                       |
| Ciclo de vida del preview        | `tests/video-preview-lifecycle.test.jsx` comprueba que modificar duración o recorte del mismo archivo conserva tiempo, error y región; cambiar de archivo reinicia tiempo y error; quitar selección limpia la región. Se mantienen los efectos de reset dependientes del path.                                                                                                                     |
| CSS dinámico                     | Las 14 reglas inicialmente sin coincidencia literal corresponden a variantes de `cap-btn` y `ui-select-trigger`. `src/components/ui/Button.jsx` y `src/components/ui/select.jsx` construyen esas clases por interpolación. Las entradas `src/main.jsx` y `src/pet-overlay-main.jsx` cargan `src/index.css`; las mascotas cargan además `pets.css`. No hay evidencia suficiente para borrar reglas. |
| i18n dinámico                    | `position.*`, `props.mode.*` y `catalog.applyOp.*` tienen consumidores interpolados en controles de texto, marca de agua y timeline. `tests/i18n-parity.test.js` verifica claves, valores y placeholders entre idiomas, pero no sustituye una revisión visual.                                                                                                                                     |
| IPC                              | `tests/preload-subscriptions.test.js` registra handlers reales, invoca la API expuesta y verifica eventos y cancelación de suscripciones. La ausencia de imports directos del nombre de un canal no prueba que esté muerto.                                                                                                                                                                        |
| Python empaquetado               | `tests/processor-spec-hiddenimports.test.js` comprueba cobertura de imports locales del procesador por PyInstaller. Los reexports de `processor.py` son consumidos por pruebas y monkeypatching; se mantienen. Esta comprobación no ejecuta el instalador.                                                                                                                                         |
| Herramientas                     | `scripts/release-metadata.mjs` usa `js-yaml` y `@electron/asar`; `scripts/verify-update-download.cjs` usa `js-yaml`; `components.json` configura `shadcn`. Geist, `class-variance-authority` y `tw-animate-css` ya no aparecen en el manifiesto actual: la lista histórica no es un inventario vigente.                                                                                            |

Para investigar fallos de temporales, conservar por separado el resultado de la
suite completa y el de los casos aislados. Un caso aislado aprobado no demuestra
que una carrera de cierre o borrado haya quedado corregida. La limpieza debe
esperar el cierre de los procesos y limitarse al directorio del fixture que posee.
No atribuir soluciones concurrentes de otros autores a esta auditoría.

Una ejecución completa presentó tres fallos de cancelación en
`tests/process-handler-run.test.js`; la suite aislada aprobó sus 25 tests y una
nueva ejecución completa aprobó 178 archivos y 1.253 tests, sin cambiar fuentes.
Se conserva la intermitencia como incertidumbre; no se considera corregida por
esos resultados posteriores. Lint y formato también aprobaron.

En el seguimiento se restauró el runtime local Python 3.14.8 x64 desde el
[manifiesto oficial de Windows](https://www.python.org/ftp/python/3.14.8/windows-3.14.8.json),
verificando su SHA-256. El entorno existente conserva las dependencias fijadas;
las 36 pruebas de Python pasan con ese runtime. Se compilaron las dos entradas
del renderer y el procesador mediante el spec real de PyInstaller en directorios
aislados. El ejecutable contiene los 21 hidden imports y las extensiones nativas
de NumPy; respondió a solicitudes reales de preview, texto e inpaint con FFmpeg.

Se generó un instalador NSIS x64 local, sin firma ni publicación. Su ASAR incluye
ambas entradas, main/preload, los contratos IPC y las dependencias de actualización.
También se ejecutó el procesador desde los recursos de `win-unpacked`. Estas
comprobaciones no implican que se haya instalado o publicado esa compilación.

Quedan dos límites de verificación:

- `useOperationDrag.js` lee `showFfmpegOverlay` dentro de `selectedRegionOp`, pero
  no lo declara como dependencia. Cambiar el modo de comparación puede modificar
  esa entrada sin cambiar las demás. Es un posible defecto de invalidación que
  requiere reproducir la interacción y tratarse como corrección de comportamiento,
  fuera de esta limpieza.
- Compilar ambas entradas no verifica visualmente ambas ventanas de Electron.
  Generar e inspeccionar el instalador tampoco prueba instalación, desinstalación
  ni actualizaciones en Windows. Esa validación requiere una sesión de Electron
  y una instalación de prueba antes de aprobar una release.
