# Limpieza de procesamiento y previews

Fecha: 2026-10-10. Alcance autorizado: la rama existente y sus cambios pendientes,
comparados con `origin/main`, después de la fusión de la PR #78. Se aplicaron
`clean`, `deslop` y la auditoría local `simplificar`.

## Simplificaciones aplicadas

Las líneas de esta tabla corresponden al estado anterior a la limpieza. Se
buscaron consumidores en fuentes, tests, scripts y referencias dinámicas antes
de editar; todos los candidatos aplicados son de confianza alta.

| Archivo y línea previa                      | Cambio y evidencia                                                                                                                                                                                                                                                                      |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/components/DelogoLivePreview.jsx:203`  | El helper existente reúne el fallback durante reproducción y el envío al worker durante pausa, antes repetidos en blur, inpaint y temporal. Conserva parámetros, recorte y rechazo de respuestas obsoletas; `delogo-preview-frame-sync` y las pruebas de render cubren estos contratos. |
| `main/utils/process-media-validation.js:21` | Las validaciones actualizan el mismo mapa de entradas. Se retiran el segundo mapa y la asociación paralela por índices, conservando la deduplicación y el límite de ocho validaciones concurrentes.                                                                                     |
| `python/ffmpeg_runner.py:119`               | Se eliminan el contador `_total` y `total_appended()`: no tienen consumidores ejecutables desde que el detector de bloqueo usa avance de frames o tiempo. La mención histórica en CHANGELOG se conserva; las pruebas de stderr acotado y bloqueo siguen activas.                        |
| `python/process_lifetime.py:51`             | Una sola ruta de error cierra los handles de padres y el Job Object durante su inicialización. Se conserva la captura del error de Windows antes de cerrar handles y la propiedad del Job Object hasta la salida del procesador.                                                        |
| `src/stores/slices/queueSlice.js:358`       | El reset usa un patch directo de Zustand; el callback anterior no leía estado. La cancelación de miniaturas y la liberación de paths conservan su orden.                                                                                                                                |

Los tres informes de rendimiento ahora identifican sus 62 referencias a
`.audit-tmp/` como rutas locales. Los archivos referenciados no están presentes
en el checkout actual; sus mediciones históricas no se verificaron nuevamente.
Los enlaces restantes apuntan a archivos disponibles en el repositorio.

## Candidatos conservados

- Reexports de `processor.py`, canales IPC y funciones de invalidación de
  cachés: tienen consumidores de runtime, empaquetado o monkeypatching.
- Guardas de cancelación, timeouts, confirmación de salida y cierre de procesos:
  protegen fallos externos y carreras; sus pruebas se conservan.
- Suscripciones Zustand y dependencias de hooks: cambiarlas puede reiniciar
  reproducción o modificar la invalidación del preview.
- Controles experimentales del instrumental de rendimiento: sus variantes
  forman parte de la matriz documentada. Los anclajes que ya no coinciden con
  fuentes actuales siguen fallando explícitamente.

## Verificación de esta limpieza

- Línea base, antes de editar: `npm run verify` terminó con exit 1. Lint,
  formato y los 38 archivos Python aprobaron; JavaScript tuvo 178 archivos
  aprobados y uno fallido, con 1.210 casos aprobados y dos fallidos.
- Los dos fallos fueron en `tests/preview-frame-seek.test.js`: un archivo
  temporal desapareció durante el caso del último frame y FFmpeg devolvió
  4294967294 al crear el fixture con audio más largo. La repetición aislada
  aprobó sus ocho casos. No se atribuye una corrección a esta limpieza.
- Gate completo posterior: `npm run verify`, exit 0 y
  `verify: all gates passed`. Lint y formato aprobaron; JavaScript aprobó
  179 archivos y 1.212 casos; Python aprobó sus 38 archivos de pruebas.
- `npm run build:processor`: exit 0; PyInstaller verificó Python, NumPy y los
  módulos temporales empaquetados. `python/test_process_lifetime.py` aprobó sus
  tres métodos con el ejecutable recién generado, sin skips.
- El parser de PowerShell aprobó `scripts/performance/sample-memory.ps1`;
  `ast.parse` aprobó los 64 archivos Python de fuentes, tests e instrumental.
- Vite compiló ambas entradas del renderer con `TEMP` y `TMP` apuntando a un
  directorio propio bajo `.tmp/` en el repositorio.
- El instrumental `audit-jobs.mjs` completó una copia sintética, generó el
  informe y los fingerprints decodificados; `compare-job-audits.mjs` aprobó una
  comparación del informe consigo mismo. Este smoke comprueba ejecución e
  integridad del formato, no ganancias de rendimiento ni las mediciones
  históricas.
- `git diff --check`: exit 0. Los enlaces relativos de los informes disponibles
  resuelven y Prettier comprueba su formato.

Los primeros intentos de build fallaron al borrar un temporal de esbuild bajo
el directorio temporal de Windows, incluso con un subdirectorio propio:
`Access is denied`. Una transformación independiente de `void 0;` repetido
hasta superar 1 MiB reprodujo el error sin importar código de Beru. La
compilación posterior aprobó con los temporales dentro del workspace; no se
modificaron dependencias ni configuración del proyecto.

No se verificaron instalación, desinstalación ni actualización de un instalador.
