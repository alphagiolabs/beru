# Refactor de archivos sobre-fatigados — Diseño

**Fecha**: 2026-06-17
**Estado**: Aprobado
**Alcance**: `python/processor.py`, `src/components/VideoPreview.jsx` + 4 componentes fáciles (`StatusFooter`, `StyleEditor`, `TableEditorFocusPanel`, `PropertiesPanel`)
**Fuera de alcance**: `batchSlice.js` y `queueSlice.js` (contrato de regresión explícito en `export-pipeline.test.js:422` — se deja para otra vuelta)

## Principio rector

**Comportamiento idéntico.** Conservar todas las funciones, sus firmas públicas y su semántica observable. El refactor es reorganización (mover código a módulos/componentes más pequeños), no reescritura. La red de tests existente (331 passed JS + 18 passed Python) es la validación.

## Baseline de validación

- `npm test -- --run`: 331 passed, 2 skipped (46 archivos) — verde
- `python python/test_delogo.py`: 18 passed, 0 failed — verde
- Criterio: verde **antes** (baseline) y verde **después** de cada fase. Si una fase rompe tests, se revierte y diagnostica.

## Enfoque elegido

- **processor.py**: Enfoque A — paquete `beru_processor/` con `runtime.py` para globals. `processor.py` queda como shim delgado.
- **VideoPreview.jsx**: shell que crea `videoRef` + estado zoom/pan, pasa a 5 hijos.
- **4 componentes**: partición en sub-componentes/secciones, sin tocar lógica.

---

## Sección 1 — `processor.py` → paquete `beru_processor/`

### Estructura

```
python/
  processor.py                  # shim delgado (~150 líneas): main(), __main__, constantes de manifest
  beru_processor/
    __init__.py                 # re-exports públicos para compat
    runtime.py                  # TODAS las globals + helpers (_safe_print, _check_cancelled, _emit_job_progress, _init_ffmpeg_globals)
    logging_setup.py            # setup_logging, logger
    ffmpeg/
      __init__.py
      binaries.py               # find_ffmpeg, find_ffprobe
      probe.py                  # ffprobe, _ffprobe_via_ffmpeg, _parse_frame_rate, _parse_channel_layout,
                               #   _empty_probe_result, job_video_info, _CHANNEL_LAYOUT_TO_COUNT
      hwaccel.py                # _test_hw_encoder_real, detect_hw_encoder, build_hwaccel_args, _HW_ENCODER_CACHE
      drawtext_caps.py          # _get_drawtext_options, _drawtext_supports, caches
      encode.py                 # build_encode_args, build_audio_args, build_filter_thread_args,
                               #   resolve_x264_threads, _AUDIO_COPY_CODECS
      run.py                    # _run_ffmpeg, _run_ffmpeg_stream, _kill_ffmpeg_process,
                               #   _stderr_buffer_append, _extract_error_line, _should_retry_ffmpeg,
                               #   _is_transient_error, regexes, MAX_RETRIES, RETRY_DELAYS, MAX_STDERR_*
    fonts/
      __init__.py
      registry.py               # _init_font_dirs, _windows_registry_fonts, get_system_fonts,
                               #   _font_name_key, _font_style_candidates, _resolve_font, FONT_DIRS, _SYSTEM_FONTS_CACHE
      text_layout.py            # _estimate_char_width, _wrap_text_to_width, _truncate_text, _fit_font_size,
                               #   _text_clusters, _apply_letter_spacing_fallback
    processors/
      __init__.py
      shared.py                 # _region_to_pixels, _build_enable_clause, _overlay_opts, _coerce_int,
                               #   _normalize_operation, _text_bg_enabled, _text_box_pad, _text_layout_bounds,
                               #   _build_region_bg_drawbox
      text.py                   # build_drawtext
      blur.py                   # build_blur_filter (NUEVO, extraído del inline en build_filter_complex)
      crop.py                   # build_crop_filter (NUEVO, extraído del inline)
      delogo.py                 # cluster delogo + VALID_DELOGO_METHODS, _optimize_delogo_for_speed,
                               #   _fit_delogo_rect, _build_padded_region, _build_cleanup_filter,
                               #   _build_mirror_patch, _build_delogo_chain
      image.py                  # build_image_overlay (NUEVO, extraído) + _build_watermark_filter
      graph.py                  # build_filter_complex (slimmed a dispatcher) + ImageInputAllocator
    batch/
      __init__.py
      sizing.py                 # _get_available_ram_mb, _memory_cap_workers, resolve_max_workers,
                               #   _ENCODER_CAPS, _RAM_PER_JOB_MB, MAX_WORKERS_CAP, AUTO_TARGET_WORKERS
      retry.py                  # _retry_failed_enabled, _should_retry_failed_job, _should_retry_ffmpeg,
                               #   wrappers de batch_errors, _job_failed_result, _cleanup_ffmpeg_partial,
                               #   _output_path_from_ffmpeg_cmd, _input_path_from_ffmpeg_cmd
      orchestration.py          # _process_one, _execute_batch, process_jobs
    preview/
      __init__.py
      frame.py                  # render_preview_frame, preview_frame_main, preview_frame_worker_main
```

### Claves del Enfoque A

1. **`runtime.py` es el único dueño de estado mutable global.** Las funciones que hoy leen/escriben `FFMPEG`, `_BATCH_ACTIVE_WORKERS`, `_cancel_event`, los caches, etc., las importan de `runtime.py`. Concurrencia y orden de inicialización idénticos — solo mudó la dirección de memoria.
2. **`processor.py` queda como shim**: `main()`, `__main__`, `JOB_MANIFEST_TYPE`/`JOB_MANIFEST_VERSION`, e imports de `beru_processor`. Contrato subprocess preservado al 100% (`--preview-frame-worker`, `--preview-frame <json>`, `<jobs.json>`).
3. **`beru_processor/__init__.py` re-exporta** símbolos públicos como red de seguridad (nada importa `processor.py` como módulo hoy — es subprocess standalone).
4. **Extracciones nuevas** (única lógica nueva, refactor puro): `build_blur_filter`, `build_crop_filter`, `build_image_overlay` se levantan del inline de `build_filter_complex` a funciones nombradas. El string de filtro generado debe ser byte-identical. El allocator `img_input_index` (closure) se convierte en `ImageInputAllocator` en `processors/graph.py`.
5. **No se elimina ninguna función.** Los wrappers delgados sobre `batch_errors` se conservan en `batch/retry.py`. Marcados como candidatos a limpieza futura, no se tocan ahora.
6. **Doble normalización** de `_normalize_operation` se conserva tal cual (idempotente; eliminarla es cambio de comportamiento fuera de scope).

### Riesgo y mitigación

- **Imports circulares**: `runtime.py` no importa sub-módulos. Orden: `logging_setup` → `runtime` → `ffmpeg/*` → `fonts/*` → `processors/*` → `batch/*` → `preview/*` → `processor.py`.
- **Validación por sub-fase**: `python -c "import beru_processor"` + `python python/test_delogo.py` + `npm test` (cubre `python.batch-errors`, `python.ffmpeg-path`, `preview-frame`, `concurrency`, `encode-profile-contract`).

---

## Sección 2 — `VideoPreview.jsx` → shell + 5 hijos

`VideoPreview` queda como **shell** que crea `videoRef` y posee estado zoom/pan + `isSplitCompare`.

### Componentes

- **`VideoStage`** — elemento `<video>` + empty state + videoError overlay + ResizeObserver. `videoRef` lo crea el shell y lo pasa.
- **`ZoomPanController`** — zoom/pan refs+state, `clampPan`/`applyZoom`/`zoomIn`/`zoomOut`/`zoomReset`, wheel + pan listeners, split-compare reset, UI controles zoom. Recibe `videoRef`, `outerRef`, `wrapperRef`, `isSplitCompare`.
- **`OperationOverlays`** — op map + image drag cluster + window listeners. Recibe `videoRef`, `sel.operations`, `imageDataCache`, `currentTime`.
- **`LivePreviewOverlays`** — IIFEs blur/text/batch/watermark + batch text drag cluster + `DelogoLivePreview` + `useCanvas`. Recibe `videoRef`, `currentRegion`, `sidebarMode`, `activeTool`, `textInput`, `blurStrength`, `templateRegions`, `watermark`, `selectedTemplateRegionId`, store actions.
- **`TransportBar`** — seek bar + timeline markers + botones transport + time display + FFmpeg compare toolbar + `handleRenderPreviewFrame` + listener `beru:preview:renderFrame`. Recibe `videoRef`, `duration`/`currentTime`/`playing`/`muted`/`seeking` + setters, `sel`, preview state + setters.

### Claves

1. **`videoRef`** lo crea el shell, lo pasa a los 5 hijos. Refs zoom/pan viven en `ZoomPanController`; `outerRef`/`wrapperRef` en el shell; `canvasRef` en `LivePreviewOverlays`; `isSplitCompareRef` en el shell.
2. **Estado zoom/pan dual (state+ref)** vive en `ZoomPanController`. `isSplitCompare` se computa en el shell y se pasa.
3. **Sin prop-drilling innecesario**: cada hijo lee sus selectores del store directamente.
4. **`handleBatchTextDragStart`** reaches into `useEditorStore.getState()` — se mantiene igual dentro de `LivePreviewOverlays`.
5. **Pares listener-start-end** se mueven **juntos** al hijo que los posee; deps arrays idénticos.

### Riesgo

- Orden de efectos y stale closures en window-listeners de drag. Mitigación: cada par effect-handler-start-end se mueve junto; deps arrays conservados idénticos.

---

## Sección 3 — Los 4 componentes fáciles

### `TableEditorFocusPanel.jsx` → `table-editor/sections/`

Sub-secciones: `Header.jsx`, `EmptyState.jsx`, `TextContent.jsx`, `Alignment.jsx`, `Typography.jsx`, `Color.jsx`, `Background.jsx`, `Stroke.jsx`, `Shadow.jsx`, `Position.jsx`, `TimeRange.jsx`. Cada una recibe `focusedOp` + `updateFocused` (+ `focusedVideo` para Position). **Riesgo bajo**: sin estado, sin lógica. Preservar patch keys de `updateFocused` y `clampRegionToVideo` en Position.

### `StyleEditor.jsx` → `style-editor/`

Helpers puras (`samePresetValue`, `presetMatches`, `presetTextShadow`, `presetPreviewTextStyle`) a `style-editor/preset-utils.js`. Sub-secciones (PresetSwatches, FontFamily, FontWeight, Size, Alignment, Color, BoldItalic, Background, Stroke, Shadow). **`patch` se queda** en el componente principal (load-bearing, routing batch-vs-single). **Contrato de tests crítico**: preservar `data-text-style-preset` y `data-preset-id` en botones de preset.

### `StatusFooter.jsx` → `status-footer/`

Sub-componentes ya limpios: `FooterChip`, `SegmentedProgress`, `BeruMark`, `ExecutionHistoryPanel`, `UpdateModal`, `UpToDateDialog`, `UpdateChangelog` a archivos propios. Helpers (`formatRunTitle`, etc.) a `status-footer/utils.js`. `StatusFooter` principal conserva los 3 effects y lógica tri-state de open-flags. **Contratos**: aria attrs (`aria-expanded`, `aria-label`, `role="contentinfo"`), auto-open-on-ready, no-permanent-dismiss badge.

### `PropertiesPanel.jsx` → `properties-panel/`

Partir por `activeTool`/`sidebarMode`: `DelogoControls.jsx`, `ImageWatermarkControls.jsx`, `BlurControls.jsx`, `CoordinateInputs.jsx`, `TimeRange.jsx`, `ModeTabs.jsx`. `PropertiesPanel` principal conserva branching y rendera `<StyleEditor/>`, `<PresetManager/>`, `<BatchPanel/>`. Preservar mutación image-scale (L221-234) y quick-position math (L260-269).

---

## Sección 4 — Fases de ejecución + validación

Orden por **menor riesgo primero**. Cada fase = branch throwaway + PR separado (per AGENTS.md).

| Fase | Archivos                                               | Validación                                                                                           |
| ---- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| 1    | `StatusFooter.jsx` → `status-footer/`                  | `npm test` (status-footer + header-batch-summary)                                                    |
| 2    | `StyleEditor.jsx` → `style-editor/`                    | `npm test` (style-editor-presets + store.logic)                                                      |
| 3    | `TableEditorFocusPanel.jsx` → `table-editor/sections/` | `npm test` (table-editor)                                                                            |
| 4    | `PropertiesPanel.jsx` → `properties-panel/`            | `npm test` (excel-mapping-modal + app-render)                                                        |
| 5    | `VideoPreview.jsx` → shell + 5 hijos                   | `npm test` (text-overlay + app-render)                                                               |
| 6    | `processor.py` → `beru_processor/` (sub-fases 6.1-6.5) | `npm test` + `python python/test_delogo.py` + `python -c "import beru_processor"` tras cada sub-fase |

### Checklist por fase (HARD RULE AGENTS.md)

0. **Identity check**: `gh auth status` → `alphagiolabs`; `git remote -v` → `alphagiolabs/beru`. Fix BEFORE continuing si alguno está mal.
1. Crear throwaway branch: `git checkout -b throwaway/refactor-<fase>`.
2. Implementar (cambios quirúrgicos).
3. `npm test` verde (y python tests en fase 6).
4. Commit Conventional Commits: `refactor: ship v1.6.31 — split <archivo> into <paquete>`.
5. Push: `git push -u origin throwaway/refactor-<fase>`.
6. PR: `gh pr create --base main --head throwaway/refactor-<fase> --title "..." --body "..."`.
7. Tras merge, borrar branch throwaway (local + remote).

### Criterio de éxito global

`npm test` verde (331+ passed) + `python test_delogo.py` 18 passed + `python -c "import beru_processor"` sin error + app corre sin regresiones de comportamiento.
