# 09 — Verificación de tooling y tests (post-cambio)

Fecha: 2026-09-30 · Rol: revisor de verificación (read-only; solo se escribió este documento)

## Veredicto

**CONDICIONAL — un bloqueante.** El refactor de tooling/tests es funcional y no pierde cobertura de
forma silenciosa, pero `scripts/test-python.mjs` — archivo nuevo del que dependen `npm run
test:python`, `npm run verify` y `tests/python-test-wiring.test.js` — **sigue ignorado por
`.gitignore` y no es commiteable**. En cualquier clone/CI limpio, `test:python` falla con
MODULE_NOT_FOUND y `npm test` falla en `python-test-wiring`. Hay que añadir
`!/scripts/test-python.mjs` a la allowlist antes de commitear.

## Resultados por comprobación

### 1. .gitignore / visibilidad de scripts — FALLO PARCIAL

- `git check-ignore -v scripts/verify.mjs scripts/regression-guard.mjs`: solo casan las reglas de
  negación (`.gitignore:93`, `:90`); `git add -n` confirma `add` para ambos. Correcto.
- **BLOQUEANTE:** `git check-ignore -v scripts/test-python.mjs` → `.gitignore:82:/scripts/*` y
  `git add -n` lo rechaza ("paths are ignored"). El archivo es `??` no listado en status (ignorado)
  y no está en `git ls-files`. La allowlist (`.gitignore:83-92`) cubre los 9 scripts tracked +
  `verify.mjs` + `regression-guard.mjs`, pero **olvidó `test-python.mjs`** — el fix de silent-skip
  no se puede commitear.
- `scripts/rg-head-raw.sh` también queda ignorado (no referenciado por nada; parece scratch
  intencional — verificar con el autor).
- `.worktrees/` se conserva (movida al final del bloque, no eliminada).

### 2. scripts/test-python.mjs — OK

- Descubre **28/28** archivos `python/test_*.py` (`readdirSync` + filtro `test_*.py`, ordenado);
  coincide con `Get-ChildItem`. Ejecutado en vivo: **all 28 passed**, exit 0, salida legible.
- Fail-fast correcto por inspección (`scripts/test-python.mjs:26-47`): exit 1 si 0 archivos, si el
  spawn falla, o propagando `result.status` del primer test que falla. Sin silent-skip.
- `tests/python-test-wiring.test.js` (30 tests, verde) es la guarda anti-regresión: enumera el
  directorio dinámicamente y exige paridad con `listPythonTests()` + que cada `def test_*` se invoque.
- Confirma el bug original: la cadena hardcodeada vieja en `package.json` solo corría **17 de 28**
  archivos (omitía `test_copy_scheduling`, `test_drawtext_*`, `test_hw_failed_retry`,
  `test_job_worker`, `test_logo_preview_export_parity`, `test_normalized_fonts_cache`,
  `test_op_active_fixtures`, `test_preview_frame_limits`, `test_trim_export`, `test_delogo_e2e`,
  `test_delogo`... ). El nuevo runner restaura los 11 omitidos.
- Nota: la afirmación "duplicate `test:python` key removed" no se observa en HEAD — solo había 1
  ocurrencia; el diff reemplaza la cadena hardcodeada por el runner y añade `verify`.

### 3. scripts/regression-guard.sh — OK

- Las **19 rutas** referenciadas existen (16 `tests/*.test.js` + 3 `python/test_*.py`).
- Trigger B: eliminados los fantasmas `processing-errors.test.js`, `processing-logs.test.js` (y
  `batch-materialize.test.js` del Trigger C) — todos archivos borrados en el refactor; añadidos 5
  tests reales de process-\* (lista final: 6). Trigger E pasó de `npm test` a `run_verify` =
  `npm run verify` (lint + format + vitest + python) → **gate más estricto, no más laxo**.
- CRLF/mojibake en consola Windows: esperado (archivo UTF-8 con box-drawing), no es defecto.
- `bash -n` no ejecutable en esta máquina (stub de WSL); sintaxis revisada por lectura + diff.

### 4. Paridad de cobertura store.logic.test.js → store.\*.test.js — OK (48 → 47 portados + 1 drop justificado + 12 nuevos)

El archivo viejo tenía **48 `it(`** (no 58). Los 6 archivos nuevos tienen **54**:

| Archivo nuevo            | its | portados | nuevos                                                               |
| ------------------------ | --- | -------- | -------------------------------------------------------------------- |
| store.queue.test.js      | 14  | 8        | 6 (outputPathFor/outputPathsForAll/preview paths/preview signatures) |
| store.batch.test.js      | 23  | 17       | 6 (`setTextForRegion` ×5 + undo step)                                |
| store.processing.test.js | 9   | 9        | 0                                                                    |
| store.project.test.js    | 5   | 5        | 0                                                                    |
| store.operations.test.js | 2   | 2        | 0                                                                    |
| store.updater.test.js    | 1   | 1        | 0                                                                    |

- **42/48 portados** con aserciones intactas (spot-check `processAll starts a job manifest` y
  `does not start duplicate downloads`: verbatim salvo `queueItem`→`makeQueueItem`). `expect(`:
  142 → 170 (+28, coherente con +12 its nuevos).
- **4 `it` de updater no portados** a store.updater.test.js — cobertura ya duplicada en
  `tests/update-state.test.js` (preexistente, sin modificar; reducer `reduceUpdaterEvent`: metadata
  download, silent failures, duplicate check) y `tests/updater-flow.test.jsx` (preexistente;
  `downloadUpdate` llamado con `{version}` L96, `update.error === "no-update-available"` L188).
  La wiring store↔reducer (`applyUpdaterEvent`) sigue ejercitada en updater-flow L74-115.
- **1 `it` trivial degradado:** `setUpdateModalOpen controls the shared update modal flag` — ya no hay
  aserción directa del flag; queda ejercitado indirectamente (updater-flow L91 + gate en
  `UpdatePrompt.jsx:69`). Pérdida menor.
- **1 `it` eliminado con la feature:** `preserves prior execution runs when starting a new batch` —
  `executionHistory`/`startExecutionRun`/`appendLog` ya no existen (feature retirada; documentado en
  `docs/dead-code-audit.md:275`). Drop intencional, no silencioso.
- Fuera de los 6 archivos: `tests/store.deletePreset.test.js` perdió `it("refuses to delete bundled
presets")` al eliminarse el campo `source` de presets (refactor deliberado de `presets.js`).

### 5. tests/helpers/ — OK con una salvedad

- `helpers/store.js`: `makeQueueItem` es superconjunto del factory viejo (usa el real
  `createQueueItem`, `src/utils/types.js:502`; mismos defaults + campos de producción
  `sourceWidth/trimStart/audioChannels`). `installMockApi`/`resetEditorState` replican el mockApi y
  el `beforeEach` originales clave a clave (mismos ~30 campos de estado). Sin cambio de datos en
  consumidores (spot-check: store.queue addVideos, store.processing manifest, store.updater).
- Consolidación de variantes correcta: p.ej. `export-pipeline.test.js` `queueItem(i)` preserva
  `src beru://`, sourceWidth, duration, codecs vía overrides.
- **Salvedad:** `tests/helpers/python.js` tiene **0 importadores** — archivo muerto por ahora; los 8
  tests python-parity siguen con copias inline de `hasPython`/`describeIfPython`/`PY_CODE_PREFIX`.

### 6. Emojis — OK con restos menores

- `regression-guard.sh`: 0 pictogramas (solo box-drawing/em-dash/flechas). ✅❌📊 eliminados.
- `release-loop.mjs`: 13 pictogramas eliminados (✅×3 ❌ 🚀 📦×2 🔗×3 💥 📝 ⚡ ⚠ ⏱), pero quedan
  **8 secuencias emoji con VS16**: `⏭️` L59, `▶️` L205/209/213/217/230/234, `ℹ️` L270. Remoción
  parcial (o decisión consciente); AGENTS.md prohíbe emojis en código/logs.
- Cajas: las líneas sin borde derecho (L339, L370) ya estaban rotas en HEAD; L360 queda 1 char corto
  y las líneas con emoji eliminado son ~2 celdas más angostas. Cosmético, no introducido.
- `audit-config.test.js` verde (9 tests) → ningún test asertaba texto con emoji.

### 7. Lint / formato / sintaxis

- `npm run lint` → **exit 1**, pero los 12 errores `no-undef 'console'` son todos de archivos scratch
  no trackeados (`verify_store_keys.mjs`, `.tmp/ipc-audit.cjs`) — ruido de baseline en este worktree.
  Los 4 scripts modificados/nuevos pasan `npx eslint` limpios (exit 0). Ojo: `npm run verify` falla
  en ESTE árbol hasta borrar esos archivos.
- `npx prettier --check` sobre los 17 archivos tocados: limpio. (`.gitignore`/`.sh` sin parser — normal.)
- `node --check`: verify.mjs, regression-guard.mjs, test-python.mjs, release-loop.mjs → exit 0.

### 8. Vitest focalizado — OK

13 archivos, **136 tests, 0 fallos** (32 s): store.{queue 14, batch 23, processing 9, project 5,
operations 2, updater 1}, excel-import-action 5, watermark-preview-zoom-contract 2, batch-runner 13,
export-pipeline 16, audit-config 9, python-test-wiring 30, update-state 7.

## Divergencias (archivo:línea)

1. **[BLOQUEANTE]** `.gitignore:83-92` — falta `!/scripts/test-python.mjs`; el archivo queda ignorado
   por `.gitignore:82` y no es commiteable (rompe `test:python`/`verify`/`python-test-wiring` en clone limpio).
2. `tests/helpers/python.js` — creado sin consumidores (dead file; las copias inline siguen en 8 tests).
3. `scripts/release-loop.mjs` L59/205-234/270 — 8 secuencias emoji (`⏭️ ▶️ ℹ️` + VS16) no eliminadas.
4. `scripts/release-loop.mjs` L339/360/368-370 — caja sin borde derecho/padding corto (preexistente en HEAD, ahora ~2 celdas más corta).
5. Cobertura movida, no perdida: 4 its updater → `update-state.test.js`/`updater-flow.test.jsx`;
   1 it (`executionHistory`) eliminado con la feature (`dead-code-audit.md:275`); 1 it
   (`setUpdateModalOpen`) reducido a cobertura indirecta.
6. `tests/store.deletePreset.test.js` — perdió `it("refuses to delete bundled presets")` (ligado a la
   retirada del campo `source`).
7. `npm run lint` exit 1 en este worktree por scratch no trackeados (`verify_store_keys.mjs`,
   `.tmp/ipc-audit.cjs`) — baseline, no del cambio, pero rompe `npm run verify` aquí.
8. Contexto inexacto: "58 its" → real 48; "duplicate test:python key" → en HEAD solo había 1.
