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

| Archivo                                                                                 | Motivo para conservar                                                                                                                                                                        |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/components/Header.jsx`                                                             | El efecto de capacidad lee `get`; revisar estabilidad del getter y debounce antes de cambiar dependencias.                                                                                   |
| `src/components/TableEditor.jsx`                                                        | Añadir `queue` al efecto podría reiniciar tiempo y reproducción al editar la cola.                                                                                                           |
| `src/components/TextOverlay.jsx`                                                        | Revisar `screen` y `scaleY` con pruebas de autoajuste y medidas; añadirlos cambia cuándo se mide.                                                                                            |
| `src/components/VideoPreview.jsx`                                                       | Añadir selección o duración puede volver a limpiar regiones o reiniciar preview, reproducción y zoom.                                                                                        |
| `src/components/video-preview/useZoomPan.js`                                            | `videoRef` es estable en el consumidor actual; no cambiar el contrato para referencias reemplazables dentro de una limpieza.                                                                 |
| `src/features/pets/settings/PetdexPanel.jsx`                                            | `getGalleryPets()` lee el store indirectamente. `petInstalled` y `petManifestLoading` invalidan el memo y no son código muerto.                                                              |
| `src/stores/slices/watermarkSlice.js`, `src/utils/video-utils.js`                       | Mantener parámetros posicionales aunque no se lean.                                                                                                                                          |
| `python/processor.py`                                                                   | Mantener los reexports usados como superficie de compatibilidad por tests.                                                                                                                   |
| `src/utils/session-persist.js`, `main/processing-run.js`, `main/utils/beru-protocol.js` | `resetSessionWriteCache`, `invalidateBeruStatCache`, `AUTO_TARGET_WORKERS`, `getIsProcessing` y `PROCESSING_LOCK_MAX_MS` son seams intencionales vivos (estado de sesión, runs y protocolo). |
| `package.json`                                                                          | Geist, class-variance-authority, tw-animate-css y shadcn requieren comprobar CLI y empaquetado antes de retirarlos. No modificar dependencias ni lockfile.                                   |
| `src/index.css`, `src/features/pets/pets.css`                                           | Candidatos adicionales requieren revisar selectores agrupados, variantes y ambas ventanas de Electron.                                                                                       |
| `tests/e2e.placeholder.test.js`, `tests/audit-config.test.js`                           | Los tests omitidos no prueban comportamiento. No habilitar placeholders como si fueran E2E reales.                                                                                           |

Los avisos React de `act(...)` requieren aislar las actualizaciones asíncronas en
los tests que los generan; no silenciar `console.error` globalmente para ocultarlos.
