# CONTEXT — Beru domain

Beru is a batch video editor. Excel rows drive text overlays onto a queue of videos; blur, crop, delogo, and watermark are Operations on those videos. Electron main starts a Processing Run; the Python Processor consumes a Job Manifest.

## Glossary

**QueueItem** — One input video in the editor queue, with probe metadata and Operations.

**Operation** — An overlay or region effect on a video (`text`, `blur`, `crop`, `delogo`, `image`). Factory, export filter, and Job wire format live in `src/utils/operation.js`. UI uses camelCase; `operationToJobPayload` emits snake_case plus pixel Regions for the Processor.

**Region** — Normalized `{x,y,w,h}` rectangle on a video (`src/utils/types.js`). Jobs send pixel rectangles.

**Text Overlay** — Text style and layout for preview and export. Merge, persist, and hydrate live in `src/utils/text-style.js`. Preview CSS layout is `src/utils/text-layout.js`; drawtext math is the Python adapter.

**TemplateRegion** — A batch text slot (label + Region + style) filled from Excel.

**Batch Export** — Export a queue of videos using TemplateRegions filled from Excel. Workbook rows, column mapping, video matches and linked Operations form one coherent editing state. Importing or remapping Excel explicitly applies its text; editing or restoring a Session preserves per-video Operations. Row indices and match statuses are derived from workbook rows, the ID column and video filenames. Preview may show labels for empty text slots; Jobs never export those labels.

**Job** — Snake_case payload for one QueueItem: paths, dimensions, Operations, encode profile, watermark. `normalizeJob` in `shared/job-manifest.js` is the single place that defines the field set and its defaults (`pix_fmt`, `encode_profile`, `video_info_probed`, …); producers and adapters (`buildExportJob`, `createJobManifest`, `unwrapJobManifest`, `createProcessorManifest`) all route through it.

**Job Manifest** — `{ type: "beru-job-manifest", version, createdAt, jobs }` validated/normalized once by `normalizeManifest` in `shared/job-manifest.js`; legacy bare arrays are still accepted at the main-process seam.

**Processing Run** — One execution of the Processor over a Job Manifest, identified by a run id. A run produces one terminal outcome and owns its cancellation; a cancelled run releases execution capacity after termination finishes. Job results belong to that run and are counted once, including retries. A confirmed completion retains its export artifact after cancellation or a run failure; confirmed Job errors remain visible. Pending Jobs return to idle and can be retried. A failure without a Job identity produces one run-level error notice. Events and replies from an older run cannot change a newer run.

**Processor** — Packaged Python (`processor.py` / `beru-processor.exe`) that builds the FFmpeg filter graph and encodes. Each Processing Run owns its execution settings, media tools, cancellation, progress and software fallback capacity. Retry passes keep that run's cancellation and progress while reducing concurrency; subsequent runs start with independent execution state.

**Exact Preview** — A rendered frame of the selected video at its current time, including applied Operations and a valid logo draft. A frame belongs to that video, time and editing state; obsolete results cannot replace it or reopen a closed preview. A previous frame may remain visible as stale while its replacement is prepared. Comparison offers live, before, after and side-by-side views in logo editing; edits return to live. Closing ends pending updates until another explicit render or, in logo editing, a change to the frame's content or time.

**Preset** — A Project document with `type: beru-preset` and no Excel. Distinct from UI `TEXT_STYLE_PRESETS`.

**Project** — Saved document (`beru-project`): templates, text style, defaults, Excel mapping, watermark. Queue is not part of the file. Validate lives in `shared/project-document.js`.

**Session** — Persistence adapter for the live Queue (and related editor fields) in sessionStorage. Not a Project file.

**Encode profile** — Named encode settings from `resources/encode-profiles.json` (`fast`, `balanced`, `quality`, `uquality`).
