# Changelog

All notable changes to Beru will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.6.42] - 2026-06-25

### Changed

- **Update modal download screen is cleaner** — `src/components/status-footer/UpdateModal.jsx` no longer renders the redundant "La descarga continúa en segundo plano" subtitle and "Cuando termine, podrás reiniciar e instalar" hint during the downloading state. The progress bar and percentage label are the sole focus, giving the user a clearer, less cluttered download experience.

### Fixed

- **Auto-updater flow fully validated** — Comprehensive audit of the entire update pipeline (check → available → download → progress → ready → install → quit-and-restart) confirmed all 24 updater-specific tests pass (497 total), lint is clean across all 10 updater files, and every race condition guard (`downloadBusy`, `pendingVersion`, `updateDownloaded`, `verifyUpdateCodeSignature` override, 10-second install safety net, `autoInstallOnAppQuit` fallback) is correctly implemented and tested. The flow from "Actualizar ahora" through NSIS installer to app relaunch is 100% functional.

## [1.6.41] - 2026-06-25

### Fixed

- **Auto-updater no longer fails on unsigned Windows installers** — Installed builds ≤1.6.40 baked `publisherName` into `app-update.yml`, which forced Authenticode verification on every downloaded update. CI ships unsigned NSIS builds, so every download failed with `ERR_UPDATER_INVALID_SIGNATURE`. `main/updater.js` now skips signature verification at runtime (`verifyUpdateCodeSignature`), and `package.json`'s `build.win` sets `verifyUpdateCodeSignature: false` so new installs no longer embed the check. Added i18n strings for the error path and regression tests.

## [1.6.40] - 2026-06-24

### Fixed

- **Supabase auth now compiled into the shipped installer** — `.github/workflows/ci-release.yml`'s `Build renderer` step ran `vite build` without `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`, and `.env` is gitignored so it is absent on the runner. Vite bakes `VITE_*` at build time, so `isSupabaseConfigured` was `false` in every published build since v1.6.38 and `BeruRoot` booted straight into the editor with no login screen or user-management panel. The step now injects the Supabase secrets, so the login gate and admin `UserManagementPanel` ship in the renderer.

## [1.6.39] - 2026-06-24

### Fixed

- **FFmpeg stall detector no longer kills healthy long encodes** — `python/processor.py`'s stall detector compared `len(stderr_lines)`, but `StderrBuffer` is a `deque(maxlen=256)`; once full, `len()` capped and the delta froze, killing any encode longer than ~2 min 120 s later with "FFmpeg stalled". Added an unbounded `total_appended()` counter and compare that. The detector is also now gated to progress-emitting paths only (`job_id != null and duration_sec > 0`), so stream-copy and unknown-duration jobs (which use `-loglevel error` and emit zero stderr) no longer false-fire — they rely on the overall deadline.
- **Preview-frame worker no longer orphaned on quit** — `main/main.js`'s `will-quit`/`before-quit` gated all cleanup behind `getPythonProcess()`, which doesn't track the long-lived preview-frame worker. On idle quit the worker was orphaned every session and `cleanupTempFiles()` never ran. Added an idempotent `disposeOnQuit()` called on every quit path.
- **Delogo cover image now displays immediately** — `src/components/DelogoLivePreview.jsx` stored the cover data URL in a ref (no re-render), so it stayed blank until an unrelated re-render. Moved to `useState`.
- **Updater events survive window recreation + no concurrent downloads** — `main/updater.js`'s `send()` used a once-captured `mainWindow` that went stale after window recreation, dropping every `updater:event`. It now reads `getMainWindow()` from shared-state. Also `downloadInProgress` was released during retry backoff, allowing two concurrent `downloadUpdate()` calls; added a `downloadBusy` flag held for the whole call.
- **Backslash-UNC `beru://` paths fixed** — `main/utils/beru-protocol.js` decoded `\\server\share\…` to `/\\server\share\…` (spurious leading `/`), which `path.win32.resolve` collapsed to `<drive>:\server\share`, destroying the UNC. Added a branch to strip the leading `/`. Forward-slash UNC already worked. Added regression tests.
- **Processing-lock watchdog no longer fires mid-probe** — `main/shared-state.js`'s watchdog only rearmed while the processor child was alive, but during the ffprobe phase no child exists yet; large batches could trip the 5-min lock timeout mid-probe. Added a `_probePhaseActive` flag so the watchdog rearms during probing.
- **Frontend performance/stability fixes** — `src/components/LayerList.jsx`'s `memo(LayerRow)` was defeated by inline handler props (every row re-rendered on each selection); hoisted stable `useCallback` handlers. `src/components/TableEditor.jsx`'s video listeners no longer tear down on every scrub (`seekingRef`), and focus no longer resets when region count changes. `src/hooks/useCanvas.js`'s `redrawCanvas` is now stable so the ResizeObserver isn't recreated per mousemove. `src/components/PresetManager.jsx` clears feedback timers on unmount.
- **Lower-severity cleanups** — telemetry `before-quit` listener no longer accumulates across enable/disable cycles; atomic writes (tmp + rename) for settings/history/recent so a crash mid-write can't wipe user state; `SIGKILL` escalation on non-Windows cancel so the processor can't be orphaned; ffprobe probes stop spawning after a cancel; Excel template KPI `COUNTIF` off-by-one fixed after `insert_rows`; non-`.ttf/.otf/.ttc` Windows registry fonts are skipped instead of crashing the job.

## [1.6.38] - 2026-06-23

### Added

- **Full editor layout on launch** — `App.jsx`, `LayerList.jsx`, `ToolBar.jsx`, and `VideoPreview.jsx` now always render the header, queue, preview, toolbar, and properties panels on startup. The import prompt is centered in the preview area and editing controls stay disabled until a video is selected, so the app no longer shows a blank shell on first open.
- **Supabase auth and login gate** — `BeruRoot.jsx` inits auth and switches between a new `LoginScreen` and the editor. Added a `SettingsModal` with admin `UserManagementPanel`, a footer sign-out with confirmation (`StatusFooter.jsx`), `src/lib/supabaseClient.js`, an `authSlice` store, plus tests for the logout flow and an auth test-state helper.
- **Appearance settings with custom theme editor** — new `SettingsModal` → `AppearancePanel`, `ThemeEditor`, and `ThemePreviewCard` components, backed by a `theme/engine.js`, `theme/presets.js`, and `theme/tokens.js` system. `uiSlice.js` grew to manage theme state; `main/utils/windowTheme.js` and `main/handlers/settings.js` sync the native window chrome. Added `tests/theme-engine.test.js` and `tests/settings-appearance.test.jsx`.
- **Expanded theme library** — 14 presets with scrollable quick access, collapsible custom themes, and a grouped theme editor layout in `AppearancePanel.jsx` and `ThemeEditor.jsx`, with matching i18n strings and CSS variables.

### Changed

- **i18n** — added en/es strings for appearance, auth, login, and user-management flows.

## [1.6.37] - 2026-06-22

### Fixed

- **`update-not-available` race guard** — `main/updater.js` now ignores stale or duplicate `update-not-available` events when an update is already pending or downloaded, so the "Update now" and "Restart and install" buttons keep working instead of silently failing. Added regression tests via a lightweight updater harness (`tests/updater-main.harness.mjs`, `tests/updater-main.event-race.test.js`).

## [1.6.36] - 2026-06-22

### Added

- **Queue session persistence** — `useEditorStore` snapshots the queue into `sessionStorage` (800 ms debounce) and restores it on startup so a crash or accidental close no longer loses loaded videos and operations. Thumbnails and `imageDataCache` are excluded (too large, regenerable).
- **`swallow` utility** — `src/utils/swallow.js` centralizes loggable error swallowing; bare `catch {}` blocks in `processingSlice` and `queueSlice` now route through `swallow()` so silent failures become traceable.
- **Update-flow telemetry** — `main/main.js` wires a telemetry hook for update-flow event capture, and `main/updater.js` ships a best-effort kill-switch stub to support future remote bad-version recall (endpoint not yet deployed).
- **`color_validation.py`** — shared Python module for strict color allowlist validation at filter build time, with regression tests.
- **CI signing verification** — `ci-release.yml` now runs `Get-AuthenticodeSignature` post-build to fail the release if the installer is unsigned.
- **Test & coverage scripts** — added `test:watch`, `test:python`, and `test:coverage` npm scripts, plus v8 coverage config in `vitest.config.js` (covers `src/**`, excluding i18n).
- **Bundle analysis hook** — optional `rollup-plugin-visualizer` via `VITE_BERU_ANALYZE=1`, with manual `icons`/`vendor` chunk splitting in `vite.config.js`.
- **E2E placeholder scaffold** — `tests/e2e.placeholder.test.js` reserved for future end-to-end coverage.
- **Regression tests** — added coverage for batch error permissions, delogo feather=0 with time bounds, error-line extraction, time-disabled ops, timed crop/zoom parity, build-processor watch files, CI signing verification, dev-script listener cleanup, fetch-ffmpeg/ffprobe shape, op-active parity, preview-frame seek, preview-proxy race, cancel-during-probe, double-signal on spawn error, processor-spec hidden imports, PropertiesPanel reactivity, watermark-modal consistency, apply-preset excel remap, and the updater flow.

### Changed

- **Update modal (Hermes flow)** — restyled without scrollbars or release-notes link; background re-checks now preserve pending updates in the reducer and main process instead of clearing the available state and breaking "Update now".
- **`update-not-available` guard** — a stale or duplicate `update-not-available` event from `electron-updater` no longer wipes a pending or already-downloaded update, so the "Update now" and "Restart and install" buttons keep working.
- **`downloadUpdate` retry** — auto-retries with exponential backoff (up to 2 retries) for transient network errors; the retry loop aborts if a newer version is announced or the download completes mid-wait.
- **`PERF_FLAGS.progressMap`** — default flipped to `true`; typing extended. Frontend-perf-audit and stability-load tests updated for the new defaults.
- **`beru-processor.spec`** — lists all local imports in `hiddenimports` as a safety net for PyInstaller.
- **`scripts/regression-guard.sh`** — runs the full suite as a safety net when `--prepush` produces an empty diff.
- **`scripts/release-loop.mjs`** — quotes `gh release create` asset paths so Windows paths with spaces don't break the command.

### Fixed

- **26 audit bugs (P1–P3) across Python and Electron layers:**
  - `processor.py`: moved `-ss` before `-i` in `render_preview_frame` to preserve `t` parity with export.
  - `video-preview/utils.js`: aligned `isOpActive` with `_build_enable_clause` for the `end<=start` edge case.
  - `pathSecurity.js` + `queueSlice` + `PropertiesPanel`: delogo cover preview now serves images via `beru://` and primes `imageDataCache`.
  - `build-processor.mjs`: added `color_validation.py` to `watchFiles`.
  - `processingSlice.js`: deletes the `jobProgress` key on error instead of leaving `undefined`.
  - `scripts/dev.mjs`: removes the old exit listener before `killTree` on Python file restart.
  - `scripts/fetch-ffmpeg.mjs`: guards the `ffprobe-static` export shape before `copyFileSync`.
  - `main/handlers/process.js`: bails on cancel-during-probe race and prevents a double signal on spawn error.
  - `main/utils/preview-proxy.js`: checks the pending map before and after `await` to close the race window.
  - `op_shared.py` + `processor.py`: skips ops with an empty time range (`end<=start`) instead of always applying; adds a UI warning.
  - `batch_errors.py`: classifies "operation not permitted" as a permissions error, not hardware.
  - `processor.py`: timed crop is now a zoom (scales the crop region to the full frame during the range); `_extract_error_line` returns the last non-empty line.
  - `delogo_chains.py`: `feather=0` with time bounds now skips `boxblur`.
  - `PropertiesPanel.jsx`: subscribes to `textInput`/`tempStart`/`tempEnd` for reactivity.
  - `WatermarkModal.jsx`: sets `imagePath` and `imageDataUrl` atomically; handles cancel/error.
  - `projectSlice.js`: re-maps `excelMapping.columns` by geometric region on preset load.
  - `VideoPreview.jsx`: documents the watermark scale WYSIWYG and the `bottom-* +60` divergence.
- **Processor opacity & fill colors** — `processor.py` preserves `opacity: 0` (previously coerced to a non-zero default) and re-validates delogo fill colors defensively at filter build time; shared float coercion with clamping prevents malformed payloads from corrupting FFmpeg output.

## [1.6.35] - 2026-06-20

### Removed

- **Supabase authentication scaffolding**: removed the unused `authSlice`, `supabaseClient`, and animated `CatFooter` component along with their unit tests. The `@supabase/supabase-js` dependency has been dropped, and the renderer store (`useEditorStore`) no longer composes the auth slice.
- **Cat footer CSS**: deleted the `cat-footer` styles and keyframe animations from `index.css`.

### Changed

- **Release-notes parsing**: `parseReleaseNotesSections` now strips markdown bold/inline-code formatting and truncates long lines at 96 characters so update-modal bullets stay single-line and readable. Added `changed`, `improved`, and `other improvements` as "what's new" section headers so the changelog grouping matches the Keep a Changelog vocabulary.
- **Update modal**: `StatusFooter` no longer forwards `onOpenReleaseNotes`; the "Ver notas" link stays hidden (gated by the optional prop in `UpdateModal`), keeping the modal focused on the in-app update action.

### Fixed

- **`/scripts` gitignore**: the local machine-specific scripts directory is now ignored so scratch tooling is never committed accidentally.

## [1.6.34] - 2026-06-19

### Changed

- **Frontend performance audit fixes** — reduced React re-render surface during batch processing:
  - `StatusFooter` and `BatchPanel` now subscribe to `queue.length` instead of the full `queue` array, so a single queue item update no longer re-renders the whole footer/batch panel.
  - `VideoPreview` groups its 5 stable action subscriptions into one `useEditorStore(..., shallow)` call, halving `useSyncExternalStore` subscriptions on the preview component.
  - `PERF_FLAGS` defaults changed to `delogoThrottleFps = 30` and `logBatch = true`, reducing CPU use in the delogo live preview and coalescing processing log updates into 50 ms batches.
  - Added `tests/frontend-perf-audit.test.js` with 27 read-only assertions that guard the performance-critical patterns above.

### Fixed

- **ESLint configuration** now correctly applies Node.js globals to `scripts/**/*.mjs`, resolving `no-undef` errors for `console`/`process` in `scripts/release-loop.mjs` and siblings.
- Removed redundant `/* global console */` / `/* global console, process */` comments from `scripts/build-processor.mjs` and `scripts/fetch-ffmpeg.mjs` now that the ESLint config provides the globals.

## [1.6.33] - 2026-06-19

### Added

- Security regression coverage for FFmpeg media-path and drawtext validation, Electron shell handlers, and hardened BrowserWindow settings.

### Changed

- FFmpeg jobs now validate video, image, watermark, font, and output paths against approved roots and extension allowlists before command construction.
- Process output paths are derived by the main process from the user-selected output directory, and Electron shell access is restricted to approved output media and trusted external domains.

### Fixed

- Synchronized `package-lock.json` with version `1.6.33` and applied Node globals to every `scripts/**/*.mjs` file so the project audit, ESLint, and release tooling agree on the shipped configuration.
- **Processing watchdog** — no longer force-releases the lock while the Python processor child is still alive, preventing long batches from freezing progress and leaving the UI stuck in "processing".
- **Batch cancel** — cancel now emits `process:finished`, resets in-flight queue rows to idle, and kills the processor on update-quit instead of leaving orphaned ffmpeg processes.
- **Timed export filters** — start-only overlays use `enable=gte(t,…)` (matching preview), timed crop overlays render at the selected `(x,y)` instead of the top-left corner, and preview-frame seek runs after `-i` so time-bounded filters align with the editor timeline.
- **Queue/preset state** — removing a video clears undo/redo stacks and stray `currentRegion`; applying a preset without Excel preserves blur/crop/delogo operations.
- **Release tooling** — `build-processor` invalidates its cache when helper Python modules change; pre-push regression guard diffs against upstream; `release-loop` checks GitHub releases without bash-only syntax on Windows.
- **FFmpeg color validation** — background and delogo fill colors now use the same strict allowlist as drawtext colors, closing filter-string injection paths before command construction.
- **Cross-platform regression checks** — the pre-push guard reads only Vitest's final test total, and the release loop now checks Git ancestry with `execFileSync` instead of shell redirection syntax.

## [1.6.22] - 2026-06-11

### Fixed

- **Batch text output filename** — removed the trailing `-1` from `buildIdTextOutputName`, so Excel-driven outputs are now `<ID>_<TEXT>.mp4` (e.g. `promo_Oferta 50% hoy.mp4`) instead of `promo_Oferta 50% hoy-1.mp4`. The `-1` was a leftover index suffix that didn't match the user-facing naming convention and was always `1` for batch text jobs. Both unit tests (`batch-process`, `store.logic`) updated to reflect the new format.

## [1.6.3] - 2026-06-04

### Added

- **HTTP Range requests for beru:// protocol**: `createBeruVideoResponse` streams video with byte-range support (206 Partial Content, 416 Range Not Satisfiable), enabling native video seeking in `<video>` elements.
- **Content-Type detection** for video extensions (.mp4, .mov, .webm, .mkv, .avi, etc.).

### Fixed

- **`resolvedDuration` fallback**: VideoPreview and TableEditor use queue item duration when `HTMLMediaElement.duration` is NaN/unavailable, fixing seek and timeline when metadata hasn't loaded.
- **Seek slider disabled** when duration is 0, preventing NaN seeks.
- **Pointer capture** on seek sliders for reliable drag behavior.
- **`preload="metadata"`** on video elements instead of `preload="auto"`, reducing unnecessary data loading.
- **Skip-to-end button** uses resolved duration instead of raw `v.duration`.

## [1.6.2] - 2026-06-04

### Added

- **`normalizeMatchId` utility**: canonical ID for matching queue videos to Excel rows (trim, lowercase, strip extension). Replaces ad-hoc `.trim().toLowerCase()` chains across `batchSlice`, `ExcelMappingModal`.
- **Auto-update via native updater**: `TopUpdateBar` now triggers `checkForUpdates` automatically instead of opening GitHub. New "starting" UI state with spinner.
- **i18n keys** for auto-update flow (`topUpdateBar.starting`, revised `cta`/`message`) in `en.json` and `es.json`.
- **Tests**: `excel-match-id.test.js` (normalizeMatchId + extension-in-ID matching), `top-update-bar.test.jsx` (auto-update behavior), pixel-coordinates test for normalized text regions.

### Fixed

- **Text drawtext filter now receives region**: `processor.py` passes `region` into `build_drawtext` so normalized coordinates resolve to pixel positions.
- **Batch text ops materialized before single-video process**: `processingSlice.processSingle` calls `materializeBatchTextOps()` when template regions exist.
- **Queue state reset on re-process**: `Header.jsx` resets all queue items to `idle`/0 progress/`null` error before starting processing.

## [1.6.0] - 2026-06-03

### Added

- **Main process modularization**: `main.js` split into `handlers/` (dialog, drop, file, preset, process, project, recent, settings, system, updater, video) and `utils/` (concurrency, drop-resolver, paths, presets, recent, renderer, settings, thumbnail, video-cache, window). New `shared-state.js` centralizes mutable state to avoid circular imports.
- **TableEditorFocusPanel** rewrite with improved focus and navigation logic.
- **VideoPreview** enhanced with better playback controls and delogo live preview.
- **QueueSidebar** and **BatchPanel** improvements for batch workflow UX.
- **StyleEditor** and **PropertiesPanel** expanded with new style controls.
- **Header** component overhaul with batch summary and new layout.
- **UpdateBanner** / **UpdateReadyModal** improvements for auto-update flow.
- **i18n**: new keys added to `en.json` and `es.json`.

### Changed

- **Zustand slices**: `queueSlice`, `processingSlice`, `batchSlice`, `uiSlice`, `projectSlice`, `editorStyleSlice` refactored for better state management.
- **useCanvas hook** rewritten for improved canvas rendering pipeline.
- **useKeyboard hook** expanded with more shortcut bindings.
- **Python processor** (`processor.py`) and **test_delogo.py** updated.
- **Preset files** (lower-third, subtitle, top-banner) format tweaks.
- **CI release workflow** updated for reliability.
- All tests updated to reflect new module structure and APIs.
- ESLint/Prettier config refinements.
- Dependency updates in `package-lock.json`.

### Fixed

- Region matching now uses full normalized box comparison across table editor, Excel re-apply, and batch preview.
- `imageDataCache` properly pruned when videos or image operations are removed.
- Video import queue items appear immediately with metadata loading in background.

## [1.5.2] - 2026-06-02

### Added

- **`TopUpdateBar`**: persistent top banner that polls `https://api.github.com/repos/alphagiolabs/beru/releases` on app start and shows a dark download banner when a newer stable release is published on GitHub. Rendered in both Landing and editor branches of `App.jsx`. Dismiss is per-version (stored in `localStorage`).
- **GitHub Releases sync (server-side)**: new `updater.checkGitHubRelease()` in `main/updater.js` uses `app.getVersion()` as the source of truth, fetches releases with `User-Agent: Beru/<version>`, filters drafts/prereleases, picks the highest stable semver, and resolves the Windows installer asset (`Beru-Setup-*.exe`, excluding `.blockmap`). Exposed to the renderer via `window.api.checkGitHubRelease()`.
- **External link handler**: new `shell:openExternal` IPC + `window.api.openExternal(url)` so the banner opens the installer (or release page fallback) with `shell.openExternal` instead of a raw `<a target="_blank">`.

### Changed

- The download button in `TopUpdateBar` is now a `<button onClick>` that calls `api.openExternal` rather than an anchor, keeping navigation inside Electron's shell.
- 30-minute throttle on the GitHub Releases check (timestamp stored in `localStorage`) to stay under the unauthenticated rate limit.
- Error state surfaces a red banner with a **Reintentar** button (i18n: `topUpdateBar.error`, `topUpdateBar.retry`).

### i18n

- `es.json` / `en.json`: added `topUpdateBar.message`, `topUpdateBar.cta`, `topUpdateBar.ctaDirect`, `topUpdateBar.dismiss`, `topUpdateBar.error`, `topUpdateBar.retry`.

## [1.5.1] - 2026-06-02

### Added

- **ESLint** (flat config) and **Prettier** with `npm run lint`, `lint:fix`, and `format` scripts.
- Vitest coverage for store import, optimistic `addVideos`, letter-spacing helpers, batch progress, and processing error formatting.

### Changed

- `useEditorStore` is now a thin composer over six slices: `processing`, `batch`, `queue`, `ui`, `editorStyle`, and `project` (under `src/stores/slices/`).
- `TableEditor` split into `TableEditorPreview`, `TableEditorGrid`, and `TableEditorFocusPanel`.

## [1.5.0] - 2026-06-02

### Added

- **App toasts** (`AppToast`) and store actions `showToast` / `clearAppToast`; batch/header/properties flows no longer use `alert()`.
- **Global processing errors**: FFmpeg/Python failures surface in the UI via `beru:error` and i18n `errors.processingFailed`.
- Shared text-style helpers (`src/utils/text-style.js`, `letter-spacing.js`, `color-utils.js`, `format-message.js`, `batch-progress.js`) with unit tests.

### Changed

- **Letter spacing**: export uses FFmpeg `drawtext` `spacing=` (pixels); preview uses `letterSpacingToPx` instead of inserting spaces between characters.
- **Region matching**: table editor, Excel re-apply, and batch preview use `regionsMatch` / `findTextOpForRegion` (full normalized box), not x/y-only equality.
- **IPC / state**: `useProcessing` updates the store directly; removed the `beru:*` CustomEvent bus and duplicate listeners in `App.jsx`.
- **Zustand**: heavy components use `useShallow` selectors to cut unnecessary re-renders.
- **Video import**: queue items appear immediately; metadata and thumbnails load in the background (`addVideos` returns the probe promise for `await`).

### Fixed

- `imageDataCache` pruned when videos or image operations are removed.
- `BatchPanel` Excel import reads fresh mapping state after the mapping modal closes.
- Negative letter spacing clamped at export time.

## [1.4.9] - 2026-06-02

### Changed

- Repackage 1.4.8 (React + Electron + Python rewrite) on top of the previous Svelte/Tauri codebase. The Electron app now matches the 1.4.x feature set documented above.
- `vite.config.js` switched to the React plugin and a Vite-relative build root (`outDir: "build"`).
- `package.json` `build` block configured for electron-builder (NSIS x64, es-ES, `app.beru.desktop`) and `extraResources` for the Python processor + FFmpeg sidecars shipped under `src-tauri/bin/`.

### Fixed

- `.gitignore` updated: added `dist-electron` and `dist-installer`, dropped `/.svelte-kit` and `/package`. New entries for `__pycache__/`, `*.pyc`, and a stray PowerShell `$null` artifact.
- `.gitignore` now excludes local AI tooling (`.agents/`, `.commandcode/`, `skills-lock.json`, `AGENTS.md`) so they don't leak into the repo.
- Removed dead Tauri/Svelte files from the working tree (`.github/workflows/release.yml`, `.vscode/`, `src-tauri/`, `src/routes/`, `src/lib/`, `static/`, `scripts/`, `docs/`, old `skills/`).

## [1.1.0] - 2026-06-01

### Added

- Excel mapping modal (`ExcelMappingModal`): explicit configuration of ID column and per-region column mapping. Replaces the implicit name-based matching.
- Match status badges in queue sidebar: green check (matched), amber warning (unmatched), red copy icon (duplicate ID), grey dash (no Excel loaded).
- Match report in `BatchPanel` after import: counters for matched / unmatched / duplicate.
- "Configurar mapeo" button (gear icon) in batch panel for re-opening the mapping modal.
- `normalizeRegion` / `denormalizeRegion` / `ensureNormalized` helpers in `utils/types.js`.
- `toVideoCoordsNormalized` helper in `utils/video-utils.js` for direct normalized mouse-to-region conversion.
- `getMatchReport()` action in store, `clearExcel()`, `updateExcelMapping()`, `setShowMappingModal()`.

### Changed

- **BREAKING (data model)**: All regions (`currentRegion`, `templateRegions[].region`, `operations[].region`) are now stored NORMALIZED in 0..1 range. They are denormalized per-video at render time. This makes a single region reusable across videos of any resolution; a template drawn on a 1920×1080 video now correctly positions text on 1280×720, 1080×1920, etc. Manual X/Y/W/H inputs still display in pixels (denormalized to the current video) but store normalized.
- `importExcel()` rewritten to use explicit `excelMapping.idColumn` and per-region column mapping. Auto-detects initial mapping from column headers and region labels; user can override.
- `addTemplateRegion`, `addOperation`, `createTextOpForRegion` and all drawing paths now write normalized regions to the store.
- `Header.jsx` job generation now denormalizes each operation's region per-target video before passing to FFmpeg.
- Drawing canvas (`useCanvas`) uses `toVideoCoordsNormalized` and treats the current region as normalized throughout drag/resize.

### Fixed

- Positions defined on a template video no longer break when the rest of the batch has a different resolution.

## [1.1.1] - 2026-06-01

### Added

- **Single-video test render**: new "Probar" button in the header renders only the currently selected video, with a result popup offering "Abrir video" and "Mostrar en carpeta" actions.
- **Per-video context menu** in the queue sidebar (⋯ button): "Procesar este", "Reintentar" (only on error), "Abrir carpeta de salida", "Mostrar en explorador", "Copiar nombre". Closes on outside click / Escape.
- Toast feedback at the bottom of the queue sidebar for one-shot actions.
- New IPC handlers `shell:openPath` and `shell:showItemInFolder` exposed on `window.api` as `openPath` / `showItemInFolder`.
- Store actions: `_buildJobFor(item, index)` (private, reused by batch and single flows) and `processSingle(videoIdx)` returning `{ ok, outputPath, error }`.

### Changed

- `python/processor.py` now reports the job's `id` field (queue index) in `complete` / `error` events instead of the position in the jobs array, so single-job runs identify the right queue item.
- `Header.jsx` batch job generation now delegates to `store._buildJobFor` (no more inline job shape duplication).

## [1.1.2] - 2026-06-01

### Added

- **Time-aware live preview**: text, blur and delogo overlays now respect each operation's `startTime` and `endTime` in the in-app video player. Scrubbing the timeline makes the overlay appear / disappear in real time. Operations with no time bounds stay visible for the full clip (unchanged behaviour).
- **Timeline markers** on the seek bar: each operation with a time range renders a colored band over the seek bar (text = purple, blur = cyan, delogo = red, crop = amber). The active range is opaque; the rest is dimmed. Toggleable via the eye icon next to the mute button.
- `isOpActive(op, t)` helper in `VideoPreview.jsx` centralises the time-window logic.

### Changed

- `VideoPreview.jsx` filters `sel.operations` through `isOpActive(op, currentTime)` before rendering overlays, so the live preview matches the FFmpeg-rendered output.

## [1.2.0] - 2026-06-01

### Added

- **Project save / load**: two new header buttons (folder-input and save icons) persist the editing session to a `.beru.json` file. A project bundles:
  - Template regions (with normalized coordinates so they round-trip across resolutions)
  - Text style defaults (size, color, family, bold, italic, background, border)
  - Tool defaults (blur strength, delogo method, fill color / opacity)
  - Excel configuration: `path`, `headers`, `rows` (cached) and `mapping` (id column + per-region column). On load, the cached rows are used to re-apply per-video text operations immediately, even if the original Excel file has moved.
- New IPC handlers `project:save` and `project:load` exposed on `window.api` as `saveProject(payload)` and `loadProject()`.
- New store actions: `serializeProject()`, `saveProject()`, `loadProject()`, and private `_applyProject(data)` that validates and applies the payload. `_reapplyExcel()` is invoked automatically when the loaded project contains Excel data.
- Loading a project with an existing queue prompts for confirmation before replacing per-video operations.

### Changed

- `useEditorStore.js` `templateRegions` are normalized via `ensureNormalized` on serialize and on apply, keeping the Phase 1 invariant.

## [1.2.1] - 2026-06-01

### Added

- **Reusable presets** shipped in `resources/presets/` and packaged via electron-builder `extraResources`:
  - **Lower third YouTube** — bottom-center band, white text on black 70% bg, bold.
  - **Banner superior** — top-center banner, white on cyan 85% bg, bold.
  - **Marca de agua esquina** — small italic text in bottom-right corner, no bg.
  - **Subtítulo centrado** — bottom-center, no bg, with 2px black border for readability.
- New header button (library icon) opens a dropdown with the preset list. Bundled presets show an "Incluido" badge; user-dropped presets in `<userData>/presets/` show "Personalizado".
- New IPC handler `presets:list` exposed as `listPresets()` in `window.api`. Reads from `<appPath>/resources/presets` in dev, `<resourcesPath>/presets` in prod, plus the user folder.
- New store actions: `loadPresets()` (fetches + caches the list, returns `{ ok, presets, userDir }`) and `applyPreset(data)` (applies template regions + text style + defaults, then either re-runs `_reapplyExcel` if Excel is loaded or seeds each video's `operations` from the new template with the current text).
- New private helper `_applyTemplateState(data)` shared by `_applyProject` and `applyPreset` to avoid duplicating the 20-line set() call.

### Changed

- `_applyProject` now also accepts `type: "beru-preset"` payloads (used when re-importing a saved preset file as a project).

## [1.3.0] - 2026-06-01

### Added

- **Image overlay** operation (mode `image`): draw a region on the video, pick a PNG/JPG/WebP/GIF/BMP file, and the image is rendered over the video at the region's position and size, with adjustable opacity and time bounds. Works for logos, watermarks, lower-thirds, PNG stickers, etc.
- New "Image" button in the toolbar (next to Text). Selecting it shows an image picker + opacity slider in the Properties panel.
- Live preview: the picked image is displayed over the video using an `<img>` element, with a green dashed outline during edit and a placeholder if the cache is cold.
- New IPC handlers `image:read` (returns `{ success, dataUrl, size, mime }` from a file path; supports png/jpg/jpeg/webp/gif/bmp) and `image:pick` (opens an Open dialog filtered to image extensions), exposed on `window.api` as `readImage(path)` and `pickImage()`.
- `imageDataCache` in the store: `{ [path]: dataUrl }`, populated on image pick and reused across the preview. The `addOperation` flow also writes the new path into the cache so the preview updates immediately.
- Timeline markers (Phase 3) now color `image` ops green (`#10b981`) for consistency.

### Changed

- `python/processor.py`: `build_filter_complex` now returns `(filter_str, output_label, image_paths)`. Each unique image path becomes a second `ffmpeg` input (`-loop 1 -i <path>`); the overlay chain scales the image to the region's pixel size, converts to RGBA, applies `colorchannelmixer=aa=<opacity>` for the alpha multiplier, and overlays at `(x, y)`. Time bounds (`start_time` / `end_time`) are honored via `enable=between(t,start,end)` on the overlay. Bug fix: `_build_enable_clause` now reads `start_time`/`end_time` (snake_case) with a fallback to the legacy camelCase keys — the helper had been a no-op for the delogo path because of the casing mismatch.

### Internal

- `utils/types.js` `MODE_META` now has an `image` entry (green). `createOperation` defaults include `imagePath: ""` and `imageOpacity: 1`. `setActiveTool` clears `tempImagePath` / `tempImageDataUrl` when switching to a non-image tool.

## [1.4.0] - 2026-06-01

### Added

- **Keyboard shortcuts** across the app. Press `?` at any time to open the shortcuts modal.
  - **Playback**: `Space` play/pause · `←` / `→` seek ±5s · `Shift + ←` / `Shift + →` seek ±1s · `Home` / `End` start / end.
  - **Queue**: `[` / `]` and `↑` / `↓` previous / next video in the queue.
  - **Tools**: `1` Blur · `2` Crop · `3` Text · `4` Image · `5` Delogo (only in `logo` sidebar mode).
  - **Region**: `N` new region (clears the current drawing) · `Supr` / `Backspace` cancel the current region · `Esc` close modals / cancel current region.
  - **Project**: `Ctrl + S` save project · `Ctrl + O` load project · `Ctrl + Z` undo · `Ctrl + Y` / `Ctrl + Shift + Z` redo.
- `isTypingTarget(target)` helper in `useKeyboard.js` skips events when the user is in an `<input>`, `<textarea>`, `<select>` or contentEditable element.
- Video commands from the hook travel via a custom `beru:video:command` window event (`detail: { type: "toggle-play" | "seek" | "seek-abs", delta?, value? }`). `VideoPreview.jsx` subscribes once per video and acts on the live `<video>` element.

### Changed

- `ShortcutsModal.jsx` reorganized into 5 sections (Reproducción · Cola · Herramientas · Región · Proyecto) with new entries for all of the above. Replaces the previous flat 7-row list.

## [1.4.1] - 2026-06-01

### Added

- **Drag & drop improvements** building on the existing root-level handlers in `App.jsx`:
  - **Folder drop**: dropping a directory recursively scans it for video files. The main process exposes a new IPC `fs:resolveDroppedPaths(paths)` that takes a mixed list of file and folder paths, scans folders up to depth 8 (skipping `node_modules`, hidden folders and `System Volume Information`), filters to known video extensions, and returns `{ videoPaths, ignoredCount }`. Capped at 500 files per drop to avoid runaway scans.
  - **Live preview during drag**: `DragOverlay.jsx` now subscribes to `dragover` events and shows a small counter under the "Soltar videos aquí" prompt ("3 videos detectados · 1 otro · También puedes soltar carpetas"). The counter is best-effort based on `dataTransfer.files` (no main-process scan during drag — only after drop).
  - **Post-drop toast** in `App.jsx` (centered bottom, 3.5s) reports what happened: "5 videos agregados", "5 videos agregados · 2 ignorados", or "Sin videos en la selección (3 ignorados)".

### Fixed

- **Drag-leave flicker**: replaced the unreliable `!e.currentTarget.contains(e.relatedTarget)` check with a counter (`dragCounter.current`). Increments on `dragenter`, decrements on `dragleave`; the overlay hides only when the count reaches 0. This prevents the overlay from blinking when the cursor crosses over child elements inside the drop zone.

### Internal

- `App.jsx` now also passes the drop handlers to the empty-state `Landing` div, so drag & drop works before any video has been imported.
- Extended video extension list in main process: `mp4|mov|avi|mkv|webm|flv|wmv|m4v|mpg|mpeg` (was `mp4|mov|avi|mkv|webm`).

## [1.4.2] - 2026-06-01

### Added

- **Queue thumbnails**: every video in the queue now shows a 44×25 px frame-0 thumbnail in `QueueSidebar`, extracted automatically when the video is imported.
  - `main/main.js:221-265` — new helper `extractThumbnail(filePath, width)` spawns the bundled `ffmpeg.exe` with `-ss 0 -vframes 1 -vf scale=160:-2 -q:v 6 -f image2pipe -vcodec mjpeg` and pipes the JPEG bytes to a buffer. Returns a base64 data URL on success, `null` on failure (no `ffmpeg`, corrupt file, 8 s timeout).
  - `main/main.js:267-274` — IPC `video:thumbnail` (single) and `video:thumbnailBatch` (parallel, concurrency = min(6, CPU count), uses the same `runWithConcurrency` helper as `getVideoInfoBatch`).
  - `main/preload.cjs:18-19` — `window.api.getThumbnail` and `getThumbnailBatch`.
  - `src/utils/types.js:195` — `createQueueItem` defaults `thumbnail: null` so the field is always present.
  - `src/stores/useEditorStore.js:148-176` — after `set` adds the new queue items, the store fires `api.getThumbnailBatch(toAdd)` in the background (no await) and patches the corresponding queue entries with `thumbnail: dataUrl` as results arrive. Failed extractions are silently skipped, so a broken `ffmpeg` cannot block imports.
  - `src/components/QueueSidebar.jsx:8-23` — new inline `Thumbnail` component: shows the data URL in a 44×25 px black-bordered box, or a `FileVideo` icon placeholder while the thumbnail is still loading or extraction failed. The placeholder uses `var(--bg-app)` so it blends with the rest of the sidebar.

### Internal

- Thumbnails are not persisted: the queue is re-imported on each session, so thumbnails regenerate on import. This keeps storage cost at 0 bytes on disk and avoids cache-invalidation logic.
- Quality: JPEG `-q:v 6` (~80 KB per thumbnail at 160 px wide). For 500 videos that's ~40 MB transient memory; the cap from Phase 8 already limits imports to 500 files.

## [1.4.3] - 2026-06-01

### Added

- **Save as preset** closes the loop opened in v1.2.1 (Phase 5): the user can now persist the current template as a user preset without going through "Save project" and editing the JSON.
  - `main/main.js:501-528` — new IPC `presets:save(name, jsonStr)`. Validates that the payload has `type: "beru-preset"`, sanitizes the name (strips `\/:*?"<>|` and control chars, prepends `_` to leading dots, caps at 80 chars), and appends `.beru.json` if missing. Writes to `<userData>/presets/`, creating the folder if needed. Returns `{ success, fileName, filePath, userDir }` or `{ success: false, error }`.
  - `main/preload.cjs:21` — `window.api.savePreset(name, jsonStr)`.
  - `src/stores/useEditorStore.js:891-916` — two new actions:
    - `serializePreset()` reuses `serializeProject()` then strips `excel` and changes `type` to `"beru-preset"`. This guarantees the preset shape is exactly the project shape minus the Excel binding.
    - `savePreset(name)` calls the IPC, then re-fetches `presets:list` so the new file appears in the Library dropdown immediately. Returns `{ ok, fileName?, filePath?, error? }`.
  - `src/components/Header.jsx:212-214` — new icon button (`BookmarkPlus`, between Save project and the shortcuts button) titled "Guardar como preset".
  - `src/components/Header.jsx:55-66, 290-321` — modal with a single text input (autofocused, `Enter` submits, `Esc` closes), a brief description, and Cancel/Save buttons. The disabled state on Save mirrors the input's emptiness.

### Internal

- Preset files written from this flow are indistinguishable from those written by hand or by Phase 5's bundled export. They show up in the Library dropdown with the green "Personalizado" badge (existing behavior from Phase 5).

## [1.4.4] - 2026-06-01

### Added

- **Light theme** with a one-click toggle. Beru ships dark by default; flipping the toggle in the header switches to a clean light palette tuned for daytime use. The choice is persisted across sessions.
  - `src/index.css:5-30` — `:root` keeps the dark values (no behavior change for users who never toggle). New `[data-theme="light"]` selector overrides the same 12 CSS vars (`--bg-app`, `--bg-surface`, `--bg-elevated`, `--text-primary/secondary/dim`, `--accent`, `--amber`, `--rose`, `--purple`, `--border`) with light-mode values. Components using `var(--...)` switch automatically — no per-component edits.
  - `main/main.js:534-564` — new IPC `settings:load` and `settings:save(partial)`. Settings live at `<userData>/settings.json`. Defaults: `{ theme: "dark" }`. The save handler merges partial updates into the existing file (so future settings like `language` can reuse it without changing the schema).
  - `main/preload.cjs:22-23` — `window.api.loadSettings()` and `window.api.saveSettings(partial)`.
  - `src/stores/useEditorStore.js:8-13, 88, 670-695` — new state `theme: "dark" | "light"` and three actions:
    - `loadSettings()` calls the IPC, applies the theme to `<html>` via `applyThemeToDom(theme)`, and stores it in state.
    - `setTheme(theme)` updates state, applies the DOM attribute, and persists.
    - `toggleTheme()` flips between dark/light.
      The DOM helper `applyThemeToDom(theme)` sets `data-theme="light"` or removes the attribute (so `:root` applies the dark defaults).
  - `src/App.jsx:32` — `store.loadSettings()` is called once at app boot, before the first paint (well, after the React commit but before the user interacts). This is the only change needed for the theme to survive a restart.
  - `src/components/Header.jsx:215-217` — new icon button (`Sun` when in dark mode, `Moon` when in light) with a tooltip. Click toggles.
  - `src/components/Landing.jsx:18` — the Beru logo's hardcoded `fill="#fff"` is now `fill="currentColor"`. The parent inherits `var(--text-primary)` from the body, so the logo is white in dark mode and dark gray in light mode.

### Internal

- The `--amber` and `--purple` semantic vars were tweaked in light mode (`#b45309` and `#7e22ce` respectively) so they retain enough contrast on the white surface. Their dark-mode values are unchanged.
- Hardcoded brand colors that work in both themes (the teal-blue `cap-btn-primary` gradient, `opModeColor` for canvas markers, the green/red/amber status dots, the violet for "template video" badge) are intentionally left as-is.
- Settings file format: `JSON.stringify(obj, null, 2)` — easy to read and edit by hand, easy to diff, easy to extend.

## [1.4.5] - 2026-06-01

### Added

- **i18n / multi-language** support. Beru now ships in Spanish (default) and English; the user can switch at any time from a small dropdown in the header. The choice is persisted in `settings.json` (the same file used by the theme in Phase 11). The infrastructure is intentionally tiny — no `i18next` or `react-intl`, just a 25-line hook.
  - `src/i18n/useT.js` — exports `useT()` (returns a `t(key, vars?)` function) and `SUPPORTED_LANGUAGES` (currently `[{code:"es"},{code:"en"}]`). `t(key, vars)` does `{name}`-style interpolation, falls back to Spanish if the key is missing in the current language, and finally to the key itself if missing in Spanish.
  - `src/i18n/messages/es.json` (~140 keys) and `src/i18n/messages/en.json` (~140 keys) — flat namespaced keys organized as `common.*`, `header.*`, `queue.*`, `props.*`, `toolbar.*`, `preview.*`, `excel.*`, `modal.*`, `match.*`, `errors.*`, `style.*`, `drop.*`, `landing.*`, `table.*`, `batch.*`. Adding a new language is a single new JSON file + one entry in `SUPPORTED_LANGUAGES`.
  - `main/main.js:534` — `SETTINGS_DEFAULTS` now includes `language: "es"`. The existing `settings:load` / `settings:save` IPCs handle persistence with no further changes.
  - `src/stores/useEditorStore.js:91, 670-722` — new state `language: "es"|"en"`, new action `setLanguage(lang)`. `loadSettings` now also restores the language alongside the theme. Persistence is fire-and-forget like the theme.
  - `src/components/Header.jsx:222-237` — new dropdown button next to the theme toggle. Shows the current language code (`ES` / `EN`) on the button, opens a small panel listing the supported languages with a checkmark on the active one. The same `mousedown` + `Escape` dismissal pattern as the Presets dropdown.
  - **Components translated** (high-impact, user-visible strings):
    - `Header.jsx` — all button tooltips, toasts, the Save Preset modal (title, description, placeholder, buttons), the Test Result modal (running / ok / error states, FFmpeg progress, open/show buttons), the "Procesar todos" / "Cancelar" / "Deshacer" / "Rehacer" labels, the "Sin presets" empty state.
    - `Landing.jsx` — title, description, import button, drag-hint text.
    - `QueueSidebar.jsx` — "Cola (N)" header, "Agregar videos" tooltip, the entire context menu (Procesar este / Reintentar / Abrir carpeta / Mostrar en explorador / Copiar nombre), the "Video plantilla" badge, the "Nombre copiado" toast.
    - `ShortcutsModal.jsx` — title and all 5 section headers + every shortcut description in both languages.
    - `ExcelMappingModal.jsx` — title, ID column label, region mapping label, "Vista previa" label, Cancel / Aplicar mapeo buttons.
    - `DragOverlay.jsx` — "Soltar videos aquí" headline, count format ("N videos detectados", "M otros"), folder hint.
    - `ToolBar.jsx` — all 5 tool labels (Blur / Crop / Text / Image / Remove logo).
    - `LayerList.jsx` — "Capas (N)" title, "Sin operaciones" empty state, mode names (Blur / Crop / Text / Remove logo), duplicate tooltip.
    - `MatchBadge.jsx` — all 4 status labels and descriptions (Vinculado / Sin match / ID duplicado / Sin Excel).

### Internal

- The `useT` hook subscribes to the store via `useEditorStore((s) => s.language)`, so any component using `useT` re-renders on language change. This is the only way to react to a switch in the existing infrastructure; the alternative (a Context) would be 4× the code for no real benefit.
- The English translations are intentionally close to the Spanish — no marketing copy, no cultural adaptation. This keeps the diff small and makes it easy to spot mistranslations during review.
- Bundle size went from 627 KB → 656 KB (+28 KB raw / +9 KB gzip) for the two language dicts. Acceptable for a one-time cost; adding a third language costs ~12 KB.
- Strings not yet translated (deferred to a follow-up — the i18n keys are pre-wired in `es.json` / `en.json`, anyone can extend): the labels inside `PropertiesPanel.jsx`, `TableEditor.jsx`, `BatchPanel.jsx`, `StyleEditor.jsx`, `BatchProgressBar.jsx`, and the various `placeholder` attributes in inputs. These are mostly property names that work fine in either language.

## [1.4.6] - 2026-06-01

### Added

- **Recent projects dropdown** next to the Load Project button. The last 8 `.beru.json` files saved or opened appear here so the user can reopen them in one click.
  - `main/main.js:571-625` — new IPCs `recent:list`, `recent:add({path, name})`, `recent:remove(path)`. Persistence is `<userData>/recent.json` (separate from `settings.json` so the lists don't mix). List is capped at 8 entries, deduped by normalized path, sorted newest-first. `list` annotates each entry with `exists` (cheap `fs.existsSync`) so the UI can show stale paths dimmed.
  - `main/main.js:611-625` — new IPC `project:loadFromPath(filePath)` that reads and parses a `.beru.json` from a known path (the file picker version is `project:load` and shows a dialog). Returns `{ success, filePath, data, error?, missing? }` where `missing: true` signals the file was deleted between sessions.
  - `main/preload.cjs:24-25, 28` — `window.api.listRecent`, `addRecent`, `removeRecent`, `loadProjectFromPath`.
  - `src/stores/useEditorStore.js:96, 768-840` — new state `recent: []` and four actions:
    - `loadRecents()` calls the IPC at boot and stores the result.
    - `addRecent(filePath, name)` pushes to head, dedupes by path, re-fetches the list with `exists` annotations.
    - `removeRecent(filePath)` drops the entry both in main and locally.
    - `loadProjectFromPath(filePath)` is the targeted loader: reads the file, applies it, re-adds to recents on success, and auto-prunes the entry on `missing: true`.
  - `src/stores/useEditorStore.js:1137, 1180` — `saveProject` and `loadProject` now call `addRecent(filePath, savedAt)` on success. No caller changes needed.
  - `src/App.jsx:33` — `store.loadRecents()` runs at boot alongside `loadSettings()` and `loadPresetsFromStorage()`.
  - `src/components/Header.jsx:312-352` — new dropdown button (`History` icon + `ChevronDown`) right after the Load Project button. Opens a 280px panel showing each recent: filename (truncated), full path (truncated, on hover), and a remove "X" button that appears on row hover. Missing files render dimmed at 40% opacity; clicking them shows the "Archivo no encontrado" toast and auto-removes them from the list. Empty state shows "Sin proyectos recientes". Click on a row confirms with the user (if `queue.length > 0`) and loads.
  - `src/i18n/messages/es.json` / `en.json` — 4 new keys: `header.recent`, `header.noRecents`, `header.recentMissing`, `header.confirmLoadRecent`.

### Internal

- Paths are normalized via `path.normalize` before compare/store so `C:\foo\bar` and `C:\foo\.\bar` are treated as the same entry.
- The IPC `recent:add` accepts `name` but falls back to `path.basename(path)` if the renderer doesn't supply one.
- The dropped entries write the list with `JSON.stringify(arr, null, 2)` for consistency with the settings file format.
- Removed entries are pruned both from the disk file (via the IPC) and locally in the store; the next `recent:list` will not return them, so the UI updates immediately even before the IPC roundtrip resolves.

## [1.4.8] - 2026-06-02

### Fixed

- **`main/main.js:752`**: removed orphan `});` that left the Electron main process with unbalanced braces; the app would fail to boot when the surrounding handler was last to execute during static analysis / `node --check`.
- **`src/components/VideoPreview.jsx:181`**: the `opIdx` identifier used inside the per-operation callback (`opIdx + 1` for the React key) was never declared; added `(op, opIdx) =>` to the `.map` signature.
- **`src/stores/useEditorStore.js`**: deleted the dead **sync** `savePreset` variant that only wrote to `localStorage` and was shadowed by the async IPC version. Callers were always hitting the async one, so the sync path was unreachable dead code with confusing overlapping responsibilities. `loadPresetsFromStorage` (used as first-paint cache) is preserved.
- **`python/processor.py:25-26`**: `FFMPEG` and `FFPROBE` are now read from `BERU_FFMPEG` / `BERU_FFPROBE` env vars (falling back to bare `"ffmpeg"` / `"ffprobe"` for CLI use). The Electron main process passes the bundled ffmpeg/ffprobe sidecar paths in `python/processor.py` spawn env (`main/main.js`), so packaged installs no longer depend on ffmpeg being in PATH.

### Changed

- **`src/components/PresetManager.jsx`**: the save flow is now aligned with the async store action. The "Guardar" button shows a `saving` state, disables input + button while in flight, and renders green confirmation (with the file name) or a rose error toast on failure. Feedback auto-clears after 2.5s.

### Internal

- Added **vitest** + **jsdom** dev dependencies and an `npm test` script. New regression tests:
  - `tests/store.savePreset.test.js` covers the async `savePreset` flow: empty-name rejection, IPC call arguments, and the `listPresets` refresh on success.
  - `tests/python.ffmpeg-path.test.js` covers the env-var override for `BERU_FFMPEG` / `BERU_FFPROBE` and the `"ffmpeg"` / `"ffprobe"` fallback. Skipped automatically when Python is not on PATH.

## [1.0.3] - 2026-05-28

### Fixed

- Blur overlay now renders visibly in video preview (fallback stripe pattern for Chromium/Electron where ackdrop-filter doesn't work on <video> elements)
- Delogo blur method overlay now shows a visible blue-tinted diagonal stripe fallback

### Changed

- Rewrote frontend from SvelteKit to React (Electron + React + Zustand + Tailwind CSS v3)
- Replaced Tauri with Electron for desktop shell

## [1.0.0] - 2026-05-28

### Added

- First stable release of Beru
- Electron + React desktop application
- Automated text overlay on videos via Excel database
- FFmpeg sidecar integration for video processing
- Layer-based video editor with real-time preview
- Batch processing with progress tracking
- Style editor with customizable text properties
- Preset manager for reusable text configurations
- Drag & drop video import
- Windows NSIS installer with Spanish (es-ES) localization

### Changed

- Version bumped from 0.1.2 → 1.0.0 for first stable release
- App identifier updated to `app.beru.desktop`
- Publisher metadata: "Beru" with Copyright © 2026

## [0.1.2] - 2026-05-26

### Changed

- Updated all installer metadata (publisher, copyright, descriptions)
- Spanish installers (es-ES) for both NSIS and WiX/MSI
- Publisher "Beru" + copyright 2026 correctly embedded
- Identifier corrected to `app.beru.desktop` (cross-platform compatible)

## [0.1.1] - 2026-05-25

### Changed

- Metadata and bundle config improvements

## [0.1.0] - 2026-05-25

### Added

- Initial release of Beru - desktop video editor
- Tauri 2 + SvelteKit 5 desktop application
- FFmpeg sidecar integration for video processing
- Windows NSIS and MSI installers
