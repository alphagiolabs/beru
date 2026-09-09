# CONTEXT — Beru domain

Beru is a batch video editor. Excel rows drive text overlays onto a queue of videos; blur, crop, delogo, and watermark are Operations on those videos. Electron main starts a Processing Run; the Python Processor consumes a Job Manifest.

## Glossary

**QueueItem** — One input video in the editor queue, with probe metadata and Operations.

**Operation** — An overlay or region effect on a video (`text`, `blur`, `crop`, `delogo`, `image`). Factory, export filter, and Job wire format live in `src/utils/operation.js`. UI uses camelCase; `operationToJobPayload` emits snake_case plus pixel Regions for the Processor.

**Region** — Normalized `{x,y,w,h}` rectangle on a video (`src/utils/types.js`). Jobs send pixel rectangles.

**Text Overlay** — Text style and layout for preview and export. Merge, persist, and hydrate live in `src/utils/text-style.js`. Preview CSS layout is `src/utils/text-layout.js`; drawtext math is the Python adapter.

**TemplateRegion** — A batch text slot (label + Region + style) filled from Excel.

**Batch Export** — Validate the queue, materialize Excel text into Operations, build Jobs, start a Processing Run. Preview uses the same materialize loop with a different text resolver (empty cells keep the region label).

**Job** — Snake_case payload for one QueueItem: paths, dimensions, Operations, encode profile, watermark.

**Job Manifest** — `{ type: "beru-job-manifest", version, createdAt, jobs }`.

**Processing Run** — One spawn of the Processor. Identity (lock, run id, child, cancel, probe phase, incomplete-output snapshot) lives in `main/processing-run.js`. The process handler starts and cancels; quit/close/update call cancel on that same interface.

**Processor** — Packaged Python (`processor.py` / `beru-processor.exe`) that builds the FFmpeg filter graph and encodes.

**Preset** — A Project document with `type: beru-preset` and no Excel. Distinct from UI `TEXT_STYLE_PRESETS`.

**Project** — Saved document (`beru-project`): templates, text style, defaults, Excel mapping, watermark. Queue is not part of the file. Validate lives in `shared/project-document.js`.

**Session** — Persistence adapter for the live Queue (and related editor fields) in sessionStorage. Not a Project file.

**Encode profile** — Named encode settings from `resources/encode-profiles.json` (`fast`, `balanced`, `quality`, `uquality`).
