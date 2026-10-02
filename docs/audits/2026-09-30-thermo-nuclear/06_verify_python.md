# 06 — Verificación del refactor de `python/` (post-cambio)

Fecha: 2026-09-30 · Rol: revisor de verificación (read-only; solo se escribió este documento)

Alcance: `processor.py` (2323 → 963 líneas) dividido en orquestador + 11 módulos nuevos
(`batch_context.py`, `media_paths.py`, `job_classify.py`, `capacity.py`, `encoders.py`,
`encode_args.py`, `media_probe.py`, `fonts.py`, `filters.py`, `ffmpeg_runner.py`, `preview.py`),
`BatchContext` en lugar de globales, y el fix `-map 0:v:0?` en el remux de audio.

## Veredicto

**EQUIVALENTE — el split no introduce regresión.** Toda divergencia semántica encontrada
contra `HEAD:python/processor.py` corresponde a trabajo intencional del usuario (WIP:
native copy, trim, pool de copias, presupuesto de commit de Windows, preview reescrito),
documentado en los tests nuevos y en `docs/dead-code-audit.md` — no a artefactos del
movimiento de código. Todas las costuras de monkeypatching que los tests ejercen siguen
resolviendo. Tests: **28/28 archivos Python verdes**, **78/78 tests vitest verdes**
(41 de ellos spawnSync contra `processor.*`).

## 1. Semántica de funciones públicas movidas

Comparado función a función contra `HEAD` (el diff de worktree mezcla WIP + refactor):

| Función                                                                                        | Destino                                   | Resultado                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `process_jobs`                                                                                 | processor.py:754                          | Firma idéntica. Retry recount cambia para jobs sin `id` (ver §D9). Devuelve `copy_workers` extra (aditivo; `process.js:55-56` reenvía el msg entero).                                                                                                     |
| `build_drawtext`                                                                               | filters.py:137 (wrapper processor.py:255) | Idéntica salvo `border_width` ahora `_coerce_int(...,0,24)` (filters.py:268) y caché ON por defecto (filters.py:116-126, `_env_flag`) — cubierto por `test_drawtext_cache.py`.                                                                            |
| `build_filter_complex`                                                                         | filters.py:407 (wrapper :266)             | Idéntica salvo `power=3` en boxblur (filters.py:462, WIP blur-parity) y `else: continue` (filters.py:513-514) que corrige bug latente: HEAD incrementaba `n` sin emitir filtro para modos desconocidos → `[tmp{n-1}]` colgante.                           |
| `_process_one`                                                                                 | processor.py:345                          | Firma `+ ctx=None` (retrocompatible). Ver §D5-D8.                                                                                                                                                                                                         |
| `ffprobe`                                                                                      | media_probe.py:220 (wrapper :205)         | Idéntica + clave aditiva `video_end` (:259, `_video_stream_end` :209).                                                                                                                                                                                    |
| `detect_hw_encoder`                                                                            | encoders.py:51                            | Reestructurado pero equivalente: candidates vacíos→`None`; `not force_test`→`candidates[0]`; probe paralelo/serial igual. `_env_flag("BERU_HW_PROBE_PARALLEL", True)` ≡ check inline de HEAD.                                                             |
| `render_preview_frame`                                                                         | preview.py:207 via wrapper :934           | Reescritura WIP (scale ≤1280, `select=gte(t,...)`, seek con radio temporal, pipes acotados, `source_only`). Contrato de retorno igual: `{ok,data_url?,error?,width,height,timestamp}`.                                                                    |
| `job_worker_main`                                                                              | processor.py:1017                         | Función nueva (worker persistente NDJSON); `main/utils/job-worker.js:36` lo invoca.                                                                                                                                                                       |
| `preview_frame_worker_main`                                                                    | processor.py:953                          | stdin binario acotado (`PREVIEW_MAX_REQUEST_BYTES`+1), despacha `source_only`; el modo `--preview-frame` de un solo shot se eliminó — documentado en `dead-code-audit.md:97`, sin consumidores (solo `--preview-frame-worker` en `preview-frame.js:121`). |
| `main`                                                                                         | processor.py:1068                         | Misma semántica; manifest parse extraído a `_load_jobs_manifest` (:982) con mensajes de error idénticos.                                                                                                                                                  |
| `ffprobe`/`job_video_info`/`_ffprobe_via_ffmpeg`/`_probe_stream_types`/`_native_copy_eligible` | wrappers :205-228                         | DI explícita (`ffprobe_bin=`, `ffmpeg_bin=`, `probe_fn=`) desde los globales de `processor` — patches de `processor.FFMPEG/FFPROBE/ffprobe` se respetan en tiempo de llamada.                                                                             |

Helpers extraídos sin cambio semántico: `validate_media_path`/`_validated_job_media`/`_path_parent`
(media*paths), `_init_font_dirs`/`get_system_fonts`/`_resolve_font`/`\_font*_`(fonts — más memo`*get_normalized_fonts`keyed por identidad del catálogo, fonts.py:163, y cap`\_RESOLVE_FONT_CACHE_MAX`),
`\_estimate_job_ram_mb`/`\_memory_cap_workers`/`resolve_max_workers`/`resolve_copy_workers`(capacity;`\_memory_cap_workers`pierde el parámetro`job_count`que HEAD no usaba),`\_ResourceAdmission`(batch_context:47 — idéntico),`find_ffmpeg`/`find_ffprobe`(media_probe:30/51 — el candidato`Path(ffmpeg_bin).parent / name`eliminado era duplicado exacto de`with_name`), `\_safe*_`/`_parse_\*`,
todo ffmpeg_runner (idéntico + `ctx=None`en`\_run_ffmpeg`/`\_run_ffmpeg_stream`), `build_audio_args`(idéntico +`force_encode=False`para el caso trim),`build_encode_args`/`build_filter_thread_args`/
`resolve_x264_threads`se quedan en processor con`active_workers` explícito (documentado en
encode_args.py:4-6).

## 2. Globales y threading

- `global` restantes: solo processor.py:233 (`FFMPEG/FFPROBE`), :250 (`_jobs_file`),
  :695 (`_BATCH_ACTIVE_WORKERS`), :813 (`_SOFTWARE_FALLBACK_ADMISSION`) — todos son costuras de
  compatibilidad deliberadas — más caches internos por módulo (`encoders._HW_ENCODER_CACHE`,
  `filters._DRAWTEXT_*`, `fonts._SYSTEM_FONTS_CACHE`/`_normalized_fonts_state`). Ninguno muta el
  namespace equivocado.
- Identidad de estado compartido verificada en runtime: `processor._cancel_event is
batch_context._cancel_event` → True; `processor._DRAWTEXT_CACHE is filters._DRAWTEXT_CACHE` → True;
  `processor._last_job_progress_emit is ffmpeg_runner._last_job_progress_emit` → True;
  `processor._jobs_file`/`batch_context._jobs_file` se sincronizan vía `_set_jobs_file` (:248-252).
- `BatchContext` se propaga `process_jobs` (:832) → `_execute_batch` (:714 `ctx=ctx`) → `_process_one`
  (:355/374/406/546-547). En retry se crea `retry_ctx` con `max_workers` reducido (:888-895).
- **`_BATCH_ACTIVE_WORKERS` sigue escribiéndose en `_execute_batch` (:695-696)** para callers sin ctx
  (tests) — mismo comportamiento que HEAD.

## 3. Cobertura del sync-hook

- `_sync_probe_binaries` (processor.py:190-202) se invoca en `process_jobs` (:763), `build_drawtext`
  (:257), `_build_watermark_filter` (:262), `build_filter_complex` (:268). Cubre los únicos lectores de
  estado de módulo movido: `filters._get_drawtext_options` (lee `media_probe.FFMPEG`, filters.py:93-108),
  `filters._DRAWTEXT_OPTIONS_CACHE/_FOR/_DRAWTEXT_CACHE_ENABLED` (copiados solo si existen en globals de
  processor — no pisan patches hechos directamente sobre `filters`), y `fonts.get_system_fonts`
  (propaga el patch a `fonts` donde `_resolve_font` lo resuelve, fonts.py:192).
- Rutas que NO necesitan sync porque inyectan explícito: `ffprobe`/`_ffprobe_via_ffmpeg`/
  `_probe_stream_types`/`_native_copy_eligible`/`job_video_info` (bins + `probe_fn` desde globals de
  processor), `render_preview_frame`/`render_source_frame` (`ffmpeg_path=FFMPEG`, `probe_fn=ffprobe`,
  `filter_fn=build_filter_complex` — este último sincroniza al entrar).
- Enumeración exhaustiva de `processor.X =` en tests (python + tests/\*.test.js): `_BATCH_ACTIVE_WORKERS`,
  `_DRAWTEXT_OPTIONS_CACHE(_FOR)`, `_process_one`, `_run_ffmpeg`, `_SOFTWARE_FALLBACK_ADMISSION`,
  `detect_hw_encoder`, `FFMPEG/FFPROBE`, `ffprobe`, `find_ffmpeg/find_ffprobe`, `get_system_fonts`,
  `job_video_info`, `process_jobs`, `_cancel_event`, `_probe_stream_types`, `_native_copy_eligible`,
  `job_worker_main`, `preview_frame_worker_main`, `_init_ffmpeg_globals`, `subprocess/os/sys/platform`
  (objetos-módulo compartidos, afectan a todos los módulos igual que antes). **Todos resuelven.**
- Nombres eliminados del namespace (`_remove_partial_output`, `_format_processing_error`,
  `_is_hardware_encode_error`, `_is_resource_pressure_error`): cero referencias en tests ni en `main/`
  — wrappers muertos tras inlinear `batch_errors.*`; seguro.
- **`_DRAWTEXT_OPTIONS_CACHE`/`_FOR` no existen por defecto en `processor`** — los tests los crean vía
  setattr y el sync los copia a `filters` (`processor.py:198-200`). Por diseño; los tests pasan.

## 4. `_process_one` — reentrancia y admisión/cancelación

- Thread-safe bajo el pool: `ctx` viaja por argumento; `active_workers = ctx.max_workers` (:355);
  el fallback `ctx=None` → `_BATCH_ACTIVE_WORKERS`/`_SOFTWARE_FALLBACK_ADMISSION`/`_check_cancelled(None)`
  lee los mismos objetos de módulo — semántica de HEAD conservada (HEAD ya era no-reentrante vía
  globales; `job_worker_main` es serial, así que una sola `BatchContext` activa).
- Admisión por pools (`_execute_batch` :573-748): dos colas (`encode`/`copy`) sobre un
  `ThreadPoolExecutor(max_workers + copy_workers)`; caps por pool + gate de RAM por-job
  (`_job_ram_estimate_mb`, incluye `_REMUX_JOB_RAM_MB=128` para copias). `acquire/release` con
  `Condition`; `_mark_cancelled` drena pendientes tras cancel. Equivalente al `_await_admission` de
  HEAD en garantías (al menos 1 job siempre admitido; lag de cancel ≤1s en ambos).
- `test_copy_scheduling.py` (pool split, native copy, cancel mid-copy, remux cancel→cancelled) y
  `test_hw_failed_retry.py` (flag `_hw_failed` → pass2 directo a libx264) verdes.

## 5. Fix `-map 0:v:0?` (remux con audio incompatible)

- `processor.py:416-426`: orden final `[ffmpeg,-y,-loglevel,error,-i,in] [-map,0:v:0?,-c:v,copy]
[-map,0:a?,-c:a,aac,...] [-movflags,+faststart] [-max_muxing_queue_size,1024] out`. Maps antes de
  codecs = argv válido; restringe la selección a 1 video + audio mapeado, descartando streams de
  subtítulos/datos que rompían el remux (propósito del fix).
- `_native_stream_copy` (ffmpeg*runner.py:376-388, byte-copy chunked con cancel cooperativo) y
  `_native_copy_eligible` (media_probe.py:323-350: ext igual, ≤1 stream/tipo en `_COPY_SAFE_STREAM_TYPES`,
  audio encaja en el contenedor, moov≺mdat para faststart) — **intactos por el fix** (solo alimentan la
  decisión de fast-path). Test `test_native_copy*\*` verde incl. elegibilidad y fallback a remux.

## 6. Empaquetado

- `beru-processor.spec:23-41` hiddenimports: los 11 módulos nuevos + `op_shared`, `delogo_chains`,
  `text_layout_helpers`, `color_validation`, `encode_profiles`, `batch_errors` — completo.
- `scripts/build-processor.mjs:66-87` watchFiles: misma cobertura completa (freshness check).
- `scripts/dev-python-watch.mjs:1-20` RUNTIME_PROCESSOR_MODULES: completo.
- Dev spawn (`processor-spawn.js:133-138`): `python python/processor.py` → dir del script en sys.path;
  imports planos resuelven. Sin ciclos de import (ningún módulo nuevo importa `processor`).

## 7. Tests

- `npm run test:python` → **all 28 test files passed** (incluye E2E con ffmpeg real: trim, logo-parity,
  delogo, copy scheduling, hw retry, job worker).
- `npx vitest run tests/python.ffmpeg-path.test.js tests/python.ffprobe-na.test.js
tests/python.batch-errors.test.js tests/python.logging.test.js tests/python.op-shared.test.js
tests/python-test-wiring.test.js` → **78/78 verdes**. Nota: una primera ejecución concurrente con
  `test:python` marcó 2 timeouts de spawnSync (10 s) en ffmpeg-path por saturación de CPU; archivo solo
  y tests aislados → 41/41 verdes. Flake de carga, no regresión.

## Divergencias/riskos residuales (ninguno es regresión del split)

- **R1 (latente):** `_process_one` no reenvía `ctx` a `_run_ffmpeg` (processor.py:432,536,552) aunque sí
  a `_native_stream_copy` (:406); `_ResourceAdmission.acquire` usa `_check_cancelled()` de módulo
  (batch_context.py:55). Equivalente hoy (el ctx real envuelve los objetos de módulo); si alguien
  construye un `BatchContext` con evento/jobs_file propios, la cancelación dentro del loop de ffmpeg y
  la admisión no lo honrarían.
- **R2 (latente):** patch de `processor._test_hw_encoder_real`, `._run_ffmpeg_stream`,
  `._get_available_ram_mb`, `._cleanup_ffmpeg_partial`, `.StderrBuffer` ya no se propaga a las
  implementaciones movidas (resuelven en su propio módulo). Ningún test actual lo hace — reducción de
  superficie patchable vs HEAD; documentada en los docstrings de los módulos.
- **D-WIP (intencionales, no del split):** `resolve_max_workers` cap ≥1080p+filtros 3→`max(3,min(6,cpus-4))`
  (capacity.py:229-230); `_get_available_ram_mb` prioriza WinAPI con `min(availPhys, availPageFile)`
  (capacity.py:44-73, cubierto por test_preview_frame_limits.py:77-90); `job_video_info` admite
  `video_info_probed` con duration=0 (media_probe.py:358); `StderrBuffer.append` corrige fuga de `_chars`
  al evictar deque lleno (ffmpeg_runner.py:130-131 — HEAD colapsaba el buffer a 1 línea); retry recount
  para jobs sin `id` por posición (processor.py:909-920); remux cancelado reporta `cancelled` en vez de
  `failed` (processor.py:439-440); `-framerate 1` omitido en imágenes animadas (processor.py:502-504);
  trim vía `trim/setpts`+`atrim/asetpts`; `--preview-frame` single-shot eliminado (documentado).
