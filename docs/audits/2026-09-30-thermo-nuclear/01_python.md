# Auditoría termo-nuclear — `python/` (Beru)

Fecha: 2026-09-30. Alcance: solo `python/` (código + tests). Auditoría de solo lectura sobre código fuente; no se modificó ningún archivo fuente.

## Mediciones

| Archivo                   |  LOC | Notas                                                                                 |
| ------------------------- | ---: | ------------------------------------------------------------------------------------- |
| `processor.py`            | 3237 | 111 `def` (89 top-level), 55 asignaciones top-level, 12 globales mutadas vía `global` |
| `delogo_chains.py`        |  422 | builders puros de filter-graph                                                        |
| `text_layout_helpers.py`  |  343 | helpers puros de layout                                                               |
| `op_shared.py`            |  255 | coerce/normalize/enable                                                               |
| `batch_errors.py`         |  193 | clasificación de errores → mensajes ES                                                |
| `build_excel_template.py` |  165 | script de una sola vez con ruta absoluta hardcodeada (`build_excel_template.py:14`)   |
| `encode_profiles.py`      |   88 | contrato JSON, bien aislado                                                           |
| `color_validation.py`     |   58 | validador puro                                                                        |
| Tests `test_*.py`         | 3345 | 28 archivos, ~130 funciones `test_*`                                                  |

Funciones más largas de `processor.py` (AST, líneas incl. docstring):

| LOC | Función                   | Línea |
| --: | ------------------------- | ----: |
| 222 | `_process_one`            |  2148 |
| 197 | `build_drawtext`          |  1285 |
| 189 | `_execute_batch`          |  2372 |
| 158 | `process_jobs`            |  2631 |
| 133 | `build_filter_complex`    |  1558 |
|  91 | `_run_ffmpeg_stream`      |  1923 |
|  84 | `_run_preview_image_cmd`  |  2869 |
|  79 | `_render_frame`           |  2998 |
|  72 | `_build_watermark_filter` |  1484 |
|  68 | `detect_hw_encoder`       |   489 |

Las 5 funciones top concentran 868 líneas (27 % del archivo). Globales mutadas vía `global`: `FFMPEG`, `FFPROBE`, `FONT_DIRS`, `_BATCH_ACTIVE_WORKERS`, `_DRAWTEXT_CACHE_ENABLED`, `_DRAWTEXT_OPTIONS_CACHE`, `_DRAWTEXT_OPTIONS_CACHE_FOR`, `_HW_ENCODER_CACHE`, `_SOFTWARE_FALLBACK_ADMISSION`, `_SYSTEM_FONTS_CACHE`, `_jobs_file`, `_normalized_fonts_state` (`processor.py`, medido con AST).

---

## Hallazgos (ordenados por severidad)

### 1. Defecto funcional probable: la rama copy+re-encode de audio no mapea el video (estructural — verificar)

En `_process_one`, la ruta stream-copy re-encodea audio cuando el codec no cabe en el contenedor (`processor.py:2217-2227`):

```python
copy_args += ["-c:v", "copy"]
copy_args += build_audio_args(output_path, src_audio_codec, job.get("audio_channels"))
```

`build_audio_args` (`processor.py:658-672`) siempre empieza con `-map 0:a?`. En FFmpeg, **la presencia de cualquier `-map` desactiva la selección automática de streams**: el video queda sin mapear y `-c:v copy` no mapea nada. Resultado: para entradas tipo `.mp4` con audio PCM (o cualquier codec ausente de `_AUDIO_COPY_CODECS` para la extensión de salida), la salida sale solo con audio — o ffmpeg falla con “Output file does not contain any stream” si además no hay audio. El test `test_native_copy_falls_back_to_remux` (`test_copy_scheduling.py:187`) ejercita el fallback a remux pero con `audio_codec=aac` copiable, así que nunca pisa esta rama. Remediación: `copy_args += ["-map", "0:v?", "-c:v", "copy"]` antes del audio (y un test con `audio_codec="pcm_s16le"` + `audio_channels=2` que inspeccione los streams del argv).

### 2. El contexto de ejecución se contrabandea por globales de módulo (regresión estructural)

`_execute_batch` escribe `_BATCH_ACTIVE_WORKERS` (`processor.py:2508-2509`) y `process_jobs` escribe `_SOFTWARE_FALLBACK_ADMISSION` (`2689-2706`); ambas son leídas dentro de `_process_one` (`2157-2369`, `2347`) y por `build_filter_thread_args`/`resolve_x264_threads` (`645`, `653`). `_jobs_file` (`1701`) alimenta `_check_cancelled` (`1712-1721`), y `FFMPEG`/`FFPROBE` se mezclan con `ffmpeg_path` explícito: `_process_one` recibe `ffmpeg_path` por parámetro pero `ffprobe()` y `_render_frame` leen los globales (`1175`, `3022`). Esto hace `_process_one` no-reentrante por configuración (dos `process_jobs` concurrentes pisarían `_SOFTWARE_FALLBACK_ADMISSION`), oculta dependencias reales (la firma miente: depende de 5 globales más), y obliga a los tests a limpiar estado de módulo a mano (`test_hw_failed_retry.py:46-63`, `test_copy_scheduling.py:123-236` — con restores manuales que además dejan `_cancel_event` set si el test falla). Remediación: un `BatchContext` (dataclass con `ffmpeg_path`, `hw_encoder`, `max_workers`, `admission`, `cancel_event`, `jobs_file`) creado en `process_jobs`/`job_worker_main` y pasado a `_execute_batch` → `_process_one`. Elimina 4-5 `global`, hace testeable por construcción, y el `_cancel_event` compartido pasa a ser un campo.

### 3. La descomposición del monolito se hizo a medias y el archivo volvió a crecer (tamaño/modularidad)

`op_shared.py`, `delogo_chains.py`, `text_layout_helpers.py`, `batch_errors.py` y `color_validation.py` dicen textualmente “Extracted from the processor.py monolith” — y pese a ello `processor.py` sigue en 3237 líneas con clusters funcionales claramente separables. Mapa de secciones contiguas hoy en el archivo:

| Rango             | ~LOC | Cluster → módulo propuesto                                                                                                                                   |
| ----------------- | ---: | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 81-190            |  110 | validación de rutas (`validate_media_path`, `_validated_job_media`) → `media_paths.py`                                                                       |
| 192-404           |  213 | fuentes del sistema (`_init_font_dirs`, `_windows_registry_fonts`, `_resolve_font`, cachés) → `fonts.py`                                                     |
| 462-556           |   95 | detección HW (`detect_hw_encoder`, `_test_hw_encoder_real`) → `encoders.py`                                                                                  |
| 559-729 + 764-951 | ~360 | args de encode/audio/threads + dimensionado de workers/RAM → `encode_args.py` / `capacity.py`                                                                |
| 954-1228          |  275 | probing (`find_ffmpeg`, `find_ffprobe`, `ffprobe`, `_ffprobe_via_ffmpeg`, `_moov_precedes_mdat`, `_probe_stream_types`, `job_video_info`) → `media_probe.py` |
| 1229-1690         |  460 | construcción de filtros (`build_drawtext`, `_build_watermark_filter`, `build_filter_complex`) → `filters/drawtext.py` + `filters/graph.py`                   |
| 1693-2146         |  454 | ejecución ffmpeg (StderrBuffer, `_run_ffmpeg*`, retry, partial cleanup, `_native_stream_copy`) → `ffmpeg_runner.py`                                          |
| 2148-2789         |  640 | orquestación por job + batch scheduler → `job_runner.py` / `batch_scheduler.py`                                                                              |
| 2791-3106         |  315 | preview (`_render_frame`, `_run_preview_image_cmd`, workers) → `preview.py`                                                                                  |
| 3108-3237         |  130 | manifest + NDJSON workers + `main()` → `cli.py`                                                                                                              |

Detalle clave para la viabilidad: los tests monkeypatchean `processor._run_ffmpeg` y similares (~76 referencias a `processor._*`); como `_process_one` resuelve `_run_ffmpeg` por nombre en los globals de su módulo en tiempo de llamada, basta `from ffmpeg_runner import _run_ffmpeg` para que `processor._run_ffmpeg` siga siendo patchable. La restricción que hoy impone la suite (“helpers seguros solo si nunca se monkeypatchean”, docstring de `op_shared.py:3-7`) desaparece: la arquitectura puede dejar de estar dictada por los tests.

### 4. Wrappers identidad hacia `batch_errors` (code-judo perdido, borrado gratis)

`processor.py:1735-1740` define `_is_hardware_encode_error` y `_is_resource_pressure_error` como puros pass-through de las funciones **ya importadas** (`34-39`); `_format_processing_error` (`1866-1867`) idem. `_remove_partial_output` (`1823-1824`) solo añade `logger=logger`. Ningún test toca estos nombres (los tests importan `batch_errors` directamente, `test_batch_errors_perms.py:14`). Borrar los 3 wrappers identidad y llamar a las funciones importadas elimina ~15 líneas y un nivel de renombrado sin valor. (`_remove_partial_output` puede quedarse o mover el `logger` a un default en `batch_errors`).

### 5. `detect_hw_encoder` triplica el mismo bucle de selección (code-judo)

`processor.py:520-553` tiene tres ramas (paralelo, serie, sin test) que todas terminan en “primer candidato de `priority` que pase”. Colapsa a: `results = probe(candidates, parallel=probe_parallel) if force_test else {c: True for c in candidates}` seguido de un único `for enc in candidates: if results.get(enc): ...return`. De ~35 líneas a ~10, y el invariante (“respeta orden de prioridad”) queda escrito una sola vez — hoy está escrito tres veces y ya diverge en el logging (“verified, parallel” vs “verified” vs nada).

### 6. `_process_one` son tres funciones pegadas (espagueti)

`processor.py:2148-2369` (222 líneas) encadena: (a) validación de job+paths, (b) ruta stream-copy con sub-rama native copy y sub-rama remux con re-encode de audio (2203-2243), (c) ruta encode con splicing de trim filter (2274-2284), construcción de comando en `_build_cmd` inner (2297-2327) y reintento software-fallback (2344-2359). El copy-branch y el encode-branch solo comparten el preámbulo de validación y el epílogo de resultado. Extraer `_process_copy_job(...)` y `_process_encode_job(...)` reduce cada pieza a <80 líneas y elimina la lectura salto-atrás que exige hoy entender `local_hw_encoder`/`hw_failed` (`2289-2295`). Adicional: `estimated_timeout` (2335) duplica el escalado de timeout que `_run_ffmpeg` ya hace internamente con `duration_sec*3` (`2024-2025`) — dos políticas de timeout solapadas en dos capas.

### 7. Construcción del filter-graph: labels por contador entrelazado, convención inconsistente (boundary)

`build_filter_complex` (`1558-1690`) usa el contador `n` con la ternaria `prev = "[0:v]" if n == 0 else f"[tmp{n-1}]"` repetida 5 veces (1606, 1616, 1624, 1642-variante, 1658) y delega en `delogo_chains._build_delogo_chain` pasando `prev_label` **sin corchetes** (`1642`: `f"tmp{n-1}"`) mientras que `build_filter_complex` devuelve `output_label` **con corchetes** (`1690`: `f"[tmp{n - 1}]"`) — dos convenciones de pad-label coexistiendo a través de la frontera entre módulos, y el parámetro `img_input_index` es un callback que inyecta el allocator de inputs dentro de `delogo_chains` (leak de responsabilidad: la numeración de inputs ffmpeg vive en el caller pero se ejerce desde el callee). Un objeto `_FilterGraph(filters=[], image_paths=[], next_tmp)` con métodos `add_input(path)`, `emit(chain)` y propiedad `prev` mata el contador, unifica la convención de corchetes y convierte `img_input_index` en un método en vez de un callback. Es el mismo patrón que ya paga dentro de `delogo_chains` con su propio `s = f"d{idx}"` (`319`).

### 8. Parser de trim duplicado y contrato implícito entre clasificador y ejecutor (espagueti)

`_job_takes_copy_path` (`2576-2582`) reparsea `trim_start`/`trim_end` con el mismo `try/float/or 0/None` que `_process_one` (`2191-2199`), y el docstring (`2566-2570`) documenta el acoplamiento: “parse errors classify as encode here”. Un `_parse_trim_window(job) -> (start, end|None)` compartido convierte ese contrato implícito en código único. Mismo patrón con el idiom `int(job.get("source_width") or job.get("width") or 0)` repetido 5 veces (`829-830`, `956-957`, `2246-2247`, `2656-2657`, `3014-3015`) → `_job_dimensions(job)`.

### 9. Micro-duplicaciones de parsing de env y emisión (espagueti/legibilidad)

- Flag booleano `not in ("0", "false", "no", "off")` ×3: `BERU_HW_PROBE_PARALLEL` (523), `BERU_DRAWTEXT_CACHE` (1273), `BERU_RETRY_FAILED` (1784) → `_env_flag(name, default)`.
- Env-int `try/int/except` ×2: `BERU_WORKERS` (887-890) y `BERU_COPY_WORKERS` (945-948) → `_env_int(name, default)`.
- `cpus // workers` con cap duplicado en `build_filter_thread_args` (643-648, cap 4) y `resolve_x264_threads` (651-655, cap 8) → `_cpus_per_worker(active_workers, cap)`.
- Payload `{"type": "progress", ...}` construido dos veces dentro de `_execute_batch` (2477-2485 vs 2496-2503) y `{"type": "complete", ...}` emitido tres veces idéntico (2210, 2237, 2363) → `_emit_job_complete(job_id, output_path)` y un `_emit_batch_progress(state, total, fname)` compartido entre `_on_done` y `_mark_cancelled`.
- `resolve_max_workers` tiene el parámetro `consider_memory=True` (`876-936`) que ningún call site usa (llamadas en 2676 y 2691) → parámetro muerto, borrar.
- `_memory_cap_workers` (`852-871`) reimplementa el “max de estimaciones por job” que ya existe como `_max_estimated_job_ram_mb` (`2620-2628`) — el primero puede llamar al segundo.

### 10. Contabilidad del retry-pass por mutación de contadores (boundary/orquestación)

`process_jobs` (`2763-2777`) fusiona los resultados de pass2 haciendo `failed -= 1` y luego re-incrementando `succeeded`/`failed`/`cancelled` según el nuevo estado — contadores deriva­dos escritos a mano. Más simple y correcto por construcción: `pass1["results"].update(pass2["results"])` y luego recomputar `succeeded/failed/cancelled` con una sola pasada sobre `results.values()` (3 líneas, `collections.Counter`). Además la fusión actual salta jobs sin `id` (`2764-2766`: `if job_id is None: continue`), dejando un job-id-less reintentado marcado como fallido aunque el retry haya funcionado — inconsistencia silenciosa.

### 11. Convención de claves mixta en watermark y parsing ad-hoc (espagueti)

El dict `watermark` usa camelCase (`imagePath`, `fontSize`, `fontColor`, `fontFamily` en `176`, `1517-1519`, `1542`) con un fallback a snake (`watermark_image`, `176`) mientras las ops pasan por `_normalize_operation` (`op_shared.py:47`). El watermark nunca se normaliza: cada consumidor re-hardcodea ambos nombres. Extender `_normalize_operation` a un `_normalize_watermark` (o una tabla camel→snake única) cierra el hueco.

### 12. Dos capas de retry con frontera difusa (boundary)

`_run_ffmpeg` reintenta por-invocación (`2026-2050`, transient/timeout) y `process_jobs` reintenta por-batch con workers reducidos (`2733-2762`, hw-error/resource-pressure). La diferencia de responsabilidad es real (fallo transitorio vs presión de recursos), pero los clasificadores se solapan — `_should_retry_ffmpeg` acepta “timeout” (`1863`) y `_should_retry_failed_job` también (`1795-1796`) — y el mismo job puede gastar 2 retries internos × 2 passes externos = hasta ~6 ejecuciones de ffmpeg. Un `RetryPolicy` único con presupuesto compartido haría el comportamiento legible y limitado.

### 13. Scheduler hand-rolled con polling (boundary — aceptable pero opaco)

`_execute_batch` (`2372-2560`) implementa un dispatcher de dos colas con `admission_cond.wait(timeout=1.0)` (2536-2538) y atributos inyectados en los futures (`fut._beru_job_pos`, `fut._beru_pool`, `2531-2532`). Funciona y está razonablemente testeado (`test_copy_scheduling.py:91-130`), pero equivale a dos `ThreadPoolExecutor` + un gate de RAM; la razón real del loop propio (admitir solo cuando hay RAM sin ocupar un thread) podría expresarse como `_ResourceAdmission.acquire()` dentro del worker y desaparecer 60 líneas de maquinaria de polling. Menor prioridad: es la pieza más delicada y su cobertura es buena.

### 14. Tests: acoplados a internals, helpers duplicados, runner manual frágil

- **Sin pytest**: `npm run test:python` (`package.json:18`) ejecuta 28 scripts con `main()` manual. Tres estilos de runner coexisten (lista explícita `test_delogo_robust.py:291-320`, llamadas directas `test_copy_scheduling.py:260-268`, `unittest.main()` `test_op_active_fixtures.py:67`). La lista manual significa que un `test_*` nuevo no listado se ignora en silencio — ya casi pasa: el formato es `tests = [...]` a mano.
- **Duplicación**: `_make_job` verbatim en `test_copy_scheduling.py:23-40` y `test_hw_failed_retry.py:10-28`; el helper “genera grafo + ffmpeg lo parsea” duplicado en `test_delogo.py:37-65` vs `test_delogo_robust.py:20-31` (`assert_graph`); restore manual de atributos en `test_hw_failed_retry.py:46-63` vs la clase `_Stub` de `test_copy_scheduling.py:43-58`. Un `conftest.py`/`_testutil.py` con `make_job`, `assert_graph` y `stub_attrs` elimina ~120 líneas de boilerplate.
- **Acoplamiento a implementación**: ~76 referencias a `processor._*` privadas y patching de atributos de módulo; la propia docstring de `op_shared.py:3-7` confiesa que la extracción se hizo en función de qué funciones “nunca son monkeypatched” — los tests dictan la arquitectura, al revés de lo sano.
- **Gaps de cobertura en lo más arriesgado**: la fusión de contadores del retry-pass (`2763-2777`), el stall-detector de `_run_ffmpeg_stream` (`1986-1996`), los fallbacks de parse de `ffprobe`/`_ffprobe_via_ffmpeg` (`1101-1218`), la tabla `_estimate_job_ram_mb`/`resolve_max_workers` (`796-936`, solo un test indirecto en `test_preview_frame_limits.py:84-87`) y la rama copy+audio-reencode del hallazgo 1 — todo sin cobertura directa. Lo que más dinero vale (RAM gating, retry accounting, clasificación de errores) es lo menos testeado.

### 15. Legibilidad y detalles menores

- `validate_media_path(full_path, _path_parent(full_path), FONT_EXTENSIONS)` dentro de `_resolve_font` (`379`, `390`): el root es el propio padre del archivo → el check de contención es tautológico; solo valida extensión. Es teatro de seguridad: o se pasan roots reales o se elimina la llamada.
- `_empty_probe_result` (`1062`) devuelve claves que `_ffprobe_via_ffmpeg` (`1144-1153`) no siempre emite (`video_end`, `bit_rate` ausentes en el fallback) → shapes inconsistentes del mismo “probe result”; un NamedTypedDict/constante canónica evitaría `dict.get` defensivos aguas abajo.
- `process_jobs` hardcodea la cadena de prioridad de perfiles `uquality > quality > balanced > fast` (`2666-2672`) en vez de derivarla del orden/severidad del contrato `ENCODE_PROFILES`.
- `build_excel_template.py:14` tiene una ruta absoluta de desarrollador como salida (`OUT = r"C:\Users\HIDROAA\..."`) — script one-off; si sigue vivo, al menos argumento CLI.
- Los `import` de nombres `_privados` entre módulos (`processor.py:41-61`, `delogo_chains.py:15-22`) son convención local ya asentada; si se sigue, convendría documentarla, porque hoy “privado” no significa nada.

---

## Propuestas de remediación trabajadas

### R1 — `BatchContext` (elimina la mitad de los globales)

```python
@dataclass
class BatchContext:
    ffmpeg_path: str
    hw_encoder: str | None
    max_workers: int
    sw_fallback_admission: _ResourceAdmission | None
    jobs_file: str | None
    cancel_event: threading.Event
```

`process_jobs` lo crea; `_execute_batch(ctx)` y `_process_one(ctx, idx, job)` lo consumen. `_check_cancelled(ctx)`, `build_filter_thread_args(ctx)` pasan a funciones explícitas. Beneficio: `_process_one` pasa a ser una función pura-de-contexto; los tests dejan de hacer `processor._SOFTWARE_FALLBACK_ADMISSION = ...` y se parchea el contexto; se eliminan `global _BATCH_ACTIVE_WORKERS`, `global _SOFTWARE_FALLBACK_ADMISSION`, `global _jobs_file` (3 de los 12 `global`).

### R2 — Extracción compatible con los tests actuales

Orden sugerido por riesgo creciente, cada paso con `npm run test:python` verde:

1. `media_probe.py`: `find_ffmpeg`, `find_ffprobe`, `ffprobe`, `_ffprobe_via_ffmpeg`, `_probe_stream_types`, `_moov_precedes_mdat`, `job_video_info`, `_safe_*`, `_parse_frame_rate`, `_empty_probe_result`, `_parse_channel_layout`, `_video_stream_end`. En processor: `from media_probe import ...` → `processor._probe_stream_types` sigue patchable (lookup por nombre en call-time).
2. `fonts.py`: el bloque 189-404 completo (cachés incluidas — viajan con el módulo).
3. `ffmpeg_runner.py`: `StderrBuffer`, `_run_ffmpeg_stream`, `_run_ffmpeg`, `_kill_ffmpeg_process`, retry helpers, `_native_stream_copy`.
4. `preview.py`: bloque 2791-3106.
5. `batch_scheduler.py`: `_ResourceAdmission`, `resolve_*`, `_memory_cap_workers`, `_execute_batch`, `process_jobs`, clasificadores `_job_*`.
6. `filters/drawtext.py` + `filters/graph.py`: `build_drawtext`, `_build_watermark_filter`, `build_filter_complex`.

Resultado: `processor.py` queda en ~300-400 líneas (validación, `_process_one`, entrypoints) o se renombra a `job_runner.py` y `cli.py`.

### R3 — Borrados seguros inmediatos

- Wrappers identidad `processor.py:1735-1740`, `1866-1867` (usar los imports de `batch_errors` ya existentes).
- Parámetro muerto `consider_memory` (`876`, `926`) y su rama.
- `_memory_cap_workers` delega en `_max_estimated_job_ram_mb` (`2620`).
- `_parse_trim_window`/`_job_dimensions`/`_env_flag`/`_env_int` compartidos (cierra hallazgos 8 y 9).
- `detect_hw_encoder` a un solo bucle (hallazgo 5).
- `_emit_job_complete`/`_emit_batch_progress` únicos (hallazgo 9).

### R4 — Scheduler y retry

- `_execute_batch`: sustituir el loop de polling por `acquire()`-inside-worker o documentar explícitamente por qué la admisión es pre-dispatch (no ocupar thread mientras espera RAM). Unificar `_RetryPolicy` con presupuesto total por job (máx. N ejecuciones ffmpeg/job) y contadores derivados por `Counter(results.values())` tras `results.update(pass2)` — elimina el bug de jobs sin `id` del hallazgo 10.
- Fix del hallazgo 1: `["-map", "0:v?", "-c:v", "copy"]` + test de argv.

### R5 — Suite de tests

- Adoptar `pytest` (`python -m pytest python/ -q`): los tests de estilo función y los unittest funcionan sin reescritura; elimina los `main()` manuales y el riesgo de tests no registrados.
- `conftest.py`/`_testutil.py` con `make_job`, `assert_graph`, `stub_attrs`, `requires_ffmpeg` marker (los archivos `test_delogo*`/`test_trim_export`/`test_logo_preview_export_parity` dependen de `bin/ffmpeg.exe` real — hoy fallan en máquinas sin el binario; pytest markers lo harían visible).
- Cobertura prioritaria nueva: clasificación de errores + contadores de retry, `_estimate_job_ram_mb`/`resolve_max_workers` (tabla), `ffprobe` fallbacks, rama copy+audio-reencode.

## Veredicto

La base es mejor que su tamaño sugiere: extracciones ya hechas (`op_shared`, `delogo_chains`, `batch_errors`, `text_layout_helpers`, `color_validation`) son limpias y los helpers de filter-graph tienen mucho cuidado de dominio (seams, feather, paridad preview/export). Pero `processor.py` re-creció a 3237 líneas porque la extracción se detuvo donde los tests monkeypatchean, el contexto de batch viaja por globales, y hay una deuda de ~150 líneas de duplicaciones y wrappers identidad que se puede borrar esta semana sin riesgo. El hallazgo 1 (video sin mapear en copy+audio-reencode) merece verificación con un ffmpeg real y un test — es el único ítem con impacto de usuario probable.
