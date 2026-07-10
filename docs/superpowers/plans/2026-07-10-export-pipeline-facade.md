# Export Pipeline Facade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract pure `exportPipeline` + injectable `batchRunner` facades so processing logic is testable without UI, while keeping the app behavior identical.

**Architecture:** Pure reducers/job builders in `export-pipeline.js`; orchestration with injected deps in `batch-runner.js`; `processingSlice` and `Header` become thin adapters.

**Tech Stack:** ESM JS, Vitest, Zustand adapters, existing `job-manifest` / `batch-process` / `execution-history`.

## Global Constraints

- No emojis in code, UI, logs, or docs.
- Keep `_buildJobFor` as a thin store wrapper for existing tests.
- Do not change `batchSlice` (Excel/templates).
- Do not split Zustand stores.
- Quality gate before done: `npm run lint`, `npm run format:check`, `npm test`.
- TDD: failing test first for each new module.

---

### Task 1: `exportPipeline` pure module

**Files:**

- Create: `src/utils/export-pipeline.js`
- Test: `tests/export-pipeline-facade.test.js`

**Interfaces:**

- Produces: `buildExportJob`, `buildExportJobs`, `applyJobProgressBatch`, `applyJobDone`, `applyJobError`, `resetQueueForRun`, `abortProcessingQueue`, `createBatchStartPatch`, `createSingleStartPatch`

- [ ] **Step 1: Write failing tests** for progress/done/error/abort/reset/start patches and `buildExportJob` shape
- [ ] **Step 2: Run tests — expect FAIL** (module missing)
- [ ] **Step 3: Implement `export-pipeline.js`** by moving logic from `processingSlice`
- [ ] **Step 4: Run tests — expect PASS**

### Task 2: `batchRunner` orchestration module

**Files:**

- Create: `src/utils/batch-runner.js`
- Test: `tests/batch-runner.test.js`

**Interfaces:**

- Consumes: `exportPipeline` patches, `createJobManifest`, `hasVideoDimensions`, `listVideosMissingBatchText`
- Produces: `validateBatchReady`, `runBatch`, `runSingle`, `cancelBatch`

- [ ] **Step 1: Write failing tests** with fake `api` + hook spies
- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Implement `batch-runner.js`**
- [ ] **Step 4: Run — expect PASS**

### Task 3: Wire `processingSlice` adapter

**Files:**

- Modify: `src/stores/slices/processingSlice.js`

- [ ] **Step 1: Replace local progress helpers + `_buildJobFor` body + mark/abort/processSingle with facade calls**
- [ ] **Step 2: Run `tests/store.logic.test.js` + facade tests — expect PASS**

### Task 4: Wire `Header` to `batchRunner`

**Files:**

- Modify: `src/components/Header.jsx`

- [ ] **Step 1: Replace inline `handleProcessAll` / cancel orchestration with `validateBatchReady` + `runBatch` / `cancelBatch`**
- [ ] **Step 2: Keep toast/i18n in Header**
- [ ] **Step 3: Run full `npm test`**

### Task 5: Quality gate

- [ ] **Step 1:** `npm run lint`
- [ ] **Step 2:** `npm run format:check` (fix if needed)
- [ ] **Step 3:** `npm test`
