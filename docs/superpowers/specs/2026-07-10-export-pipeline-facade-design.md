# Export Pipeline Facade — Design

**Date:** 2026-07-10  
**Status:** Approved (approach C)

## Problem

`useEditorStore` correctly hosts 9 slices, but export/processing logic is coupled across:

- `processingSlice` (progress reducers, job build, `processSingle`, abort)
- `queue` mutations (status/progress)
- `Header.handleProcessAll` (validation + start orchestration in UI)
- `useProcessing` (IPC → store)

`batchSlice` (Excel/templates) is a separate domain and is out of scope.

## Goal

Introduce two deep modules behind small interfaces:

1. **`exportPipeline`** — pure in-process reducers and job building (no `window`, no Zustand).
2. **`batchRunner`** — orchestration with injected `api` + state hooks (testable without UI).

Zustand `processingSlice` and `Header` become thin adapters. Observable behavior stays identical.

## Architecture

```
Header / QueueSidebar / useProcessing
        │
        ▼
processingSlice (adapter: set/get + window.api)
        │
        ├── exportPipeline   (pure)
        └── batchRunner      (orchestration; deps injected)
                │
                ├── job-manifest, batch-process, execution-history
                └── api.startProcessing / cancelProcessing
```

## Interfaces

### `src/utils/export-pipeline.js`

| Function                                                                               | Role                                                                                 |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `buildExportJob(item, index, ctx)`                                                     | Replaces `_buildJobFor` body. `ctx`: `{ encodeProfile, outputPath, watermark }`      |
| `buildExportJobs(queue, ctxForItem)`                                                   | Map queue → jobs (skip nulls)                                                        |
| `applyJobProgressBatch({ queue, jobProgress, messages, progressMap })`                 | Unified progress update; returns `{ queue, jobProgress }` with referential stability |
| `applyJobDone({ queue, jobProgress, progressDone, progressTotal, msg, progressMap })`  | Done patch                                                                           |
| `applyJobError({ queue, jobProgress, progressDone, progressTotal, msg, progressMap })` | Error patch (deletes jobProgress key)                                                |
| `resetQueueForRun(queue)`                                                              | All items → idle/0/null                                                              |
| `abortProcessingQueue(queue)`                                                          | processing → idle; returns `{ queue, queueChanged }`                                 |
| `createBatchStartPatch({ queue, jobCount })`                                           | `{ queue, progressTotal, progressDone, jobProgress, isProcessing: true }`            |
| `createSingleStartPatch({ queue, videoIdx })`                                          | Mark one item processing + progress counters                                         |

### `src/utils/batch-runner.js`

| Function                                                      | Role                                                                                                            |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `validateBatchReady({ queue, templateRegions, getCellText })` | `{ ok: true }` or `{ ok: false, code, details }` — codes: `missing_dimensions`, `missing_batch_text`, `no_jobs` |
| `runBatch({ api, jobs, hooks })`                              | Start execution run, apply start patch, `startProcessing(manifest)`; return `{ ok, error? }`                    |
| `runSingle({ api, job, videoIdx, hooks })`                    | Single-job path used by `processSingle`                                                                         |
| `cancelBatch({ api, hooks })`                                 | `cancelProcessing` + abort patch via hooks                                                                      |

**Hooks shape** (minimal):

```js
{
  startExecutionRun({ kind, jobCount }),
  applyPatch(partialState),
  getQueue(),
  finalizeActiveExecution(summary?),
  summarizeQueue(queue),
}
```

## Compatibility

- `_buildJobFor` remains on the store as a thin wrapper → `buildExportJob`.
- Public store methods keep the same signatures: `processSingle`, `updateJobProgressBatch`, `markJobDone`, `markJobError`, `abortActiveProcessing`.
- `batchSlice` unchanged.
- Single `useEditorStore` retained (no store split).

## Testing

- Unit tests for `export-pipeline` and `batch-runner` without React/Zustand.
- Existing `store.logic.test.js` / `export-pipeline.test.js` must stay green.
- Quality gate: `npm run lint`, `npm run format:check`, `npm test`.

## Non-goals

- Splitting Zustand into multiple stores.
- Refactoring Excel/`batchSlice`.
- Changing IPC protocol or Python processor.
