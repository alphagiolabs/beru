# Auditoría termo-nuclear 05 — Tooling, Tests, Scripts, Resources y Config

**Fecha:** 2026-09-30
**Alcance:** `tests/` (143 archivos, ~920 `it`), `scripts/`, `resources/`, `package.json`, `eslint.config.js`, `vite.config.js`, `vitest.config.js`, `tailwind.config.js`, `.github/workflows/`, `.githooks/`, `.gitignore`
**Método:** inspección estática, grep estructural, verificación con git (`ls-files`, `check-ignore`, `status`), ejecución cronometrada de `tests/python.ffmpeg-path.test.js` (41 tests / 9,0 s de test-time, 11 s wall).

---

## 0. Veredicto

**NO APTO — hay una bomba de relojería en la infraestructura de calidad.**

El nuevo quality gate canónico del repo (`npm run verify`, introducido en el worktree sin commitear en `package.json`, `ci-release.yml` y `regression-guard.sh`) apunta a un archivo que **`.gitignore` excluye de git y que jamás fue commiteado**. En cuanto ese WIP se pushee, CI se rompe en checkout limpio — y `git status` no muestra el archivo faltante. Alrededor de ese hecho crítico orbitan tres problemas estructurales: una suite de tests donde ~17 % de los archivos afirma sobre el _texto_ del código fuente en vez de sobre comportamiento, tests JS que prueban funciones _privadas_ de Python lanzando 39+ subprocesos de intérprete, y tres listas idénticas de módulos Python mantenidas a mano en tres lugares, cada una protegida por un test que existe únicamente para sostener la duplicación.

## 1. Mediciones

| Métrica | Valor | Evidencia |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| Archivos de test Vitest | 143 | `tests/*.test.{js,jsx}` |
| `it()` totales | ~920 | grep `^\s\*(it                                                                                                                                                | test)\(` |
| Archivos que afirman sobre texto fuente (`readFileSync` + `toContain`/`toMatch` sobre código de producción) | ~24 (≈17 %) | lista en §3.4 |
| Archivos que duplican el boilerplate `PY`/`hasPython`/`describeIfPython` | 8 | encode-profile-contract, op-active-parity, python.batch-errors, python.ffmpeg-path, python.ffprobe-na, python.logging, python.op-shared, text-layout-contract |
| Factories `queueItem`/`item` incompatibles entre archivos | ≥11 | §3.8 |
| Archivos que reemplazan `globalThis.window` por `{ api: mockApi }` | 36 | grep `globalThis.window =                                                                                                                                     | window.api =` |
| Invocaciones a APIs privadas `processor._*` desde tests JS | 39 en 5 archivos | §3.5 |
| `spawnSync(PY, ...)` en tests JS | 59 sitios / 11 archivos | §3.5 |
| `store.logic.test.js` | 1637 líneas, **1** `describe` plano, 58 `it`, ≥6 slices | §3.7 |
| `python.ffmpeg-path.test.js` | 1337 líneas, 41 `it`, 37 `spawnSync`, 9 s medidos | §3.7 |
| Warnings ESLint activos e invisibles por `--quiet` | 18 (15 `react-hooks/exhaustive-deps`, 3 `no-unused-vars`) | `npx eslint .` |
| Emojis en `release-loop.mjs` + `regression-guard.sh` | ~25 violaciones de la HARD RULE "sin emojis" | §5.1 |

---

## 2. Hallazgos CRÍTICOS

### 2.1 `scripts/verify.mjs` — el quality gate no existe en git (bomba armada en el worktree)

Estado verificado con git:

- **HEAD (commiteado):** `ci-release.yml` ejecuta `npm test` y `package.json` no tiene script `verify`. CI en main está verde hoy.
- **Worktree (sin commitear):** `M package.json` añade `"verify": "node scripts/verify.mjs"` (l. 20); `M .github/workflows/ci-release.yml` cambia el step a `npm run verify` (l. 52); `regression-guard.sh` (también `M`) llama `npm run verify` en l. 55 y 147.
- **El problema:** `.gitignore:82` contiene `/scripts/*` con una única excepción `!/scripts/dev-python-watch.mjs`. `git check-ignore -v scripts/verify.mjs` → `.gitignore:82`. `git ls-files scripts` no lista `verify.mjs` ni `regression-guard.mjs`; `git log` de ambos está vacío — **nunca fueron commiteados** y `git status` ni siquiera los muestra como `??`.
- **Detonación garantizada:** en cuanto se commitee el WIP actual (`package.json` + workflow, que sí aparecen como `M`), el próximo push hará checkout limpio en CI → `node scripts/verify.mjs` → `Cannot find module` → exit 1 → job `test` rojo → `release` (`needs: test`) nunca corre. El autor no tiene forma de darse cuenta desde `git status` porque el archivo crítico está ignorado: el worktree _parece_ completo.
- `scripts/regression-guard.mjs` (shim que localiza Git Bash en Windows) está igualmente untracked; además nada lo referencia — los hooks `.githooks/*` llaman a `regression-guard.sh` directamente con `bash`.

### 2.2 `.githooks/` — el "Loop A" entero es local-only

`.gitignore` lista `.githooks/` bajo "Local-only artifacts" y `git ls-files .githooks` está vacío. `core.hooksPath` está configurado localmente a `.githooks`. Resultado: pre-commit y pre-push (que ejecutan `regression-guard.sh --cached/--prepush`) **solo corren en esta máquina**. La "capa de seguridad adicional" que el propio script describe no protege a ningún otro clon ni a CI. Combinado con 2.1, el aparato de calidad local completo es single-machine.

### 2.3 `regression-guard.sh` Trigger B apunta a tests que no existen

`scripts/regression-guard.sh:190-194` ejecuta, cuando cambia `main/handlers/process.js`:

```
tests/processing-errors.test.js      ← NO EXISTE
tests/processing-logs.test.js        ← NO EXISTE
tests/process-input-validation.test.js  ← existe
```

`npx vitest run` sobre un archivo inexistente devuelve exit ≠ 0 → el hook reporta `[FAIL]` → **todo cambio en `process.js` produce una falsa regresión** y bloquea el commit/push (salvo `--no-verify`, que es lo que el script sugiere, convirtiendo el guard en ruido que se aprende a saltar). Nadie lo notó porque (2.2) los hooks son local-only y probablemente se saltan sistemáticamente.

Adicionalmente, Trigger A (l. 116-151) corre `test_delogo.py`, `test_delogo_e2e.py`, `test_delogo_robust.py` **y después** `npm run verify`, cuyo `test:python` vuelve a correr los mismos archivos — doble ejecución explícita. El comentario de `run_verify` (l. 50-53) dice "Este hook no debe correr `npm test` por su cuenta" y acto seguido el Trigger A ejecuta tres tests Python por su cuenta antes del gate completo.

---

## 3. Hallazgos ALTOS — suite de tests

### 3.1 `store.logic.test.js`: 1637 líneas, 1 describe, ≥6 slices

`tests/store.logic.test.js` es un solo `describe("useEditorStore logic regressions")` plano con 58 `it` que cubre, verificado contra `src/stores/slices/`:

- `queueSlice` — addVideos (l. 92,125), clearQueue (1129,1162), imageDataCache (1171,1194), outputPathFor/outputPathsForAll (1457-1609)
- `processingSlice` — processSingle (149,168), processAll (205,224,241,254), abortActiveProcessing (1398), markJobError/markJobDone (1419,1438)
- `batchSlice` — template regions, excel remap, setTextForRegion, materializeBatchTextOps (l. 372-1052, la mitad del archivo)
- `uiSlice` — `applyUpdaterEvent`/`downloadUpdate` (l. 1235-1351); estas funciones viven en `uiSlice.js`, no en "logic"
- `projectSlice` — presets, recent projects, serialización (l. 496,1098,1111,1216)
- `editorStyleSlice` — advanced text style round-trip (l. 413)

El `beforeEach` (l. 39-90) resetea ~30 campos de estado listados a mano — una copia congelada del estado inicial del store que **deriva**: cualquier campo nuevo en un slice no se resetea y los tests empiezan a contaminarse entre sí. `export-pipeline.test.js:41-73` tiene otro `RESET_STATE` casi idéntico mantenido por separado. El seam `globalThis.window = { api: mockApi }` (l. 12) + `await import` top-level (l. 14) hace que el orden import-setup sea semánticamente obligatorio — acoplamiento clásico de implementación. Y reemplaza el `window` jsdom entero, no `window.api`.

`store.deletePreset.test.js` y `store.savePreset.test.js` ya existen como archivos separados — el precedente de split existe; este archivo se quedó como cajón de sastre.

### 3.2 `python.ffmpeg-path.test.js`: 1337 líneas de tests de Python escritos en strings JS

41 `it`, 37 `spawnSync(PY, ["-c", ...])`. Cada test lanza un intérprete Python que importa `processor.py` (123 KB) — **9,0 s medidos** solo en este archivo. El nombre miente: solo ~5 tests tratan resolución de rutas ffmpeg/ffprobe; el resto cubre drawtext filters, worker admission caps, NVENC params, retries, stderr buffering — tests de `processor.py` que por algún motivo viven en un archivo llamado "ffmpeg-path".

El patrón real: cada test embeda código Python en un template literal JS (`const code = ` ... ``), lo ejecuta con `spawnSync`y parsea`JSON.parse(r.stdout.trim().split("\n").pop())`. Esto es una suite de tests de Python escrita en el lenguaje equivocado: sin asserts de Python, sin traceback útil, con un intérprete nuevo por test. La localización correcta es `python/test\_\*.py`(que existe, corre en`npm run test:python`, y donde cada uno de estos tests tardaría ~50 ms en vez de ~220 ms).

### 3.3 Tests que ejercitan APIs **privadas** de Python: 39 sitios

Desde `python.ffmpeg-path.test.js`, `ffmpeg-security.test.js`, `preview-frame-seek.test.js`, `python.batch-errors.test.js` se invoca directamente:

- `processor._test_hw_encoder_real` (privado por convención `_`)
- `processor._build_watermark_filter`, `_validated_job_media`, `_normalize_operation`, `_cleanup_ffmpeg_partial`, `_jobs_require_fonts`, `_jobs_allow_hardware`, `_job_requires_encode`, `_ResourceAdmission`, `_run_ffmpeg_stream`, `_process_one`
- Monkey-patching de estado module-private: `processor._BATCH_ACTIVE_WORKERS = 4`, `processor._DRAWTEXT_OPTIONS_CACHE = set()`, `processor._cancel_event.set()`, `processor._process_one = fake_process` (l. 662, 688, 697, 739, 762-777, 807-811, 838-920, 1318)

White-box total: cualquier rename de un símbolo `_` — refactor legítimo en Python — rompe tests JS. Y la inyección de dobles (`_process_one = fake_process`) replica el entorno de ejecución de forma frágil: si `process_one` cambia de firma, el fake acepta `**kwargs` y el test sigue verde mientras producción diverge.

### 3.4 "Grep-as-test": ~24 archivos afirman sobre el texto fuente

El antipatrón dominante de la suite. `readFileSync(código de producción)` + `expect(src).toContain/toMatch`:

- `export-pipeline-facade.test.js:320-325` — `expect(src).toContain('msg.type === "cancelled"')` sobre `main/handlers/process.js`
- `dev-script-listener-cleanup.test.js:9-27` — extrae el bloque `restartTimer = setTimeout(...)` con regex y afirma que `removeListener(` aparece **textualmente antes** que `killTree(`, y que `electron.on("exit",` no es una arrow inline. Code review implementado como regex.
- `audit-config.test.js:38-70` — regexes sobre las entrañas de `regression-guard.sh` (exige exactamente 2 líneas `(BASELINE|CURRENT)_TOTAL=` con `| tail -1`) y afirmaciones negativas sobre `release-loop.mjs` (`not.toContain("2>/dev/null")`)
- `ci-release-signing-verification.test.js` — afirma orden textual de steps y regexes sobre `ci-release.yml`
- `window-close-confirm.test.js` — `toMatch(/Cancelar y salir/)`, string de UI clavada
- `frontend-perf-audit.test.js:19-26` — afirma `const X = lazy(` para 4 modales en `App.jsx`: congela la sintaxis de declaración; un `const X = React.lazy(` o lazy() en otro archivo rompe el test sin romper el comportamiento
- `auth-listener-contract`, `beru-protocol`, `main-quit-during-probe`, `main-fatal-kill-process-tree`, `main-quit-update`, `preload-subscriptions`, `process-cancel-ownership`, `process-double-signal`, `process-cancel-output-cleanup`, `region-blur-preview`, `runtime-dependencies`, `shell-handlers`, `watermark-preview-zoom-contract`, `fetch-ffmpeg-ffprobe-shape`, `processor-spec-hiddenimports`, `build-processor-watchfiles`, `dev-python-watch`, `python-test-wiring` — mismo patrón en distinto grado

Ninguno puede detectar una regresión de comportamiento; todos fallan ante un refactor que preserve semántica. Son tests que existen para **ossificar** el código, no para protegerlo. Excepciones legítimas dentro del patrón: `python-test-wiring.test.js` (meta-check de que cada `test_*` definido se invoca — pero ver §5.4: no verifica la membresía en `package.json`), `renderer-csp.test.js` (parsea un artefacto HTML — aunque ver §4.3) y los contract tests de módulos Python que _extraen_ datos del spec para compararlos con imports reales.

### 3.5 Cobertura duplicada real

- `store.logic.test.js:1235-1275` ("keeps updater release metadata…", "keeps updater check failures silent…") replica casi verbatim `update-state.test.js:5-29,89-93` — mismos valores (`1.6.0`, `42.4`, `"Cambios de prueba"`, `"This operation was aborted"`→`aborted`). El reducer puro `reduceUpdaterEvent` ya está cubierto; el test de store solo prueba que el slice llama al reducer. Mismo par para `downloadUpdate`/`canStartDownload` (1277-1351 vs 96-101).
- `store.logic.test.js:1457-1609` (outputPathFor collisions, ranking de duplicados) solapa con `output-naming.test.js:74-123` que prueba `resolveOutputNames/Paths/Detached` directamente con más granularidad.
- `export-pipeline.test.js` vs `export-pipeline-facade.test.js`: el primero prueba el pipeline a través del store (legítimo para integración) pero repite assertions de job-shape que el segundo cubre en `buildExportJob`/`normalizeJob` — p.ej. "emits a normalized job" (facade:77) vs la batería de `jobFor`/`prepareRun` (pipeline:75-484).

### 3.6 Duplicación de fixtures y helpers — no hay fábrica canónica

- **≥11 factories `queueItem`/`item` con shapes incompatibles**: `store.logic.test.js:16` (sin `sourceWidth/sourceHeight`), `export-pipeline.test.js:13` (con `src` beru:// + sourceWidth), `export-pipeline-facade.test.js:23` (con `audioChannels`, sin `src`), `applied-delogo-edit.test.jsx:33`, `undo-redo.test.js:13`, `stability-load.test.js:7`, `thumbnail-cache.test.js:13`, `table-editor.test.jsx:20`, `batch-runner.test.js:5`, `output-naming.test.js:8`… Si el shape real de QueueItem cambia, hay que editar 11 sitios — y la divergencia ya existe (unos factories producen items que otros tests rechazarían como "unprobed").
- `tests/fixtures/` solo tiene `job-manifest.js` y `delogo-render-reference.js` (ambos buenos, usados por job-manifest/export-pipeline-facade/delogo-render-core) — falta el `makeQueueItem()` canónico.
- `RESET_STATE` duplicado: `store.logic.test.js:47-89` vs `export-pipeline.test.js:41-73` (~30 campos, mismo drift).
- Boilerplate `const PY = …; hasPython; describeIfPython` copiado en **8 archivos**; ninguno usa un `tests/helpers/python.js` (que no existe). `tests/helpers/` solo tiene `authTestState.js` y `python-imports.js`.
- El patrón correcto YA existe en el repo: `resources/op-active-fixtures.json` y `resources/text-layout-fixtures.json` — fixtures JSON compartidos JS↔Python con tests de paridad (`op-active-parity.test.js`, `text-layout-contract.test.js`). Extenderlo.

### 3.7 Tests que pasan vacuamente

`renderer-csp.test.js:66,74`: `if (!existsSync(built)) return;` — si `build/` no existe (siempre en CI: el job `test` nunca buildea; el build ocurre en el job `release` sobre Windows), los dos describes de "CSP survives the production build" retornan sin afirmar nada. Tests que no pueden fallar en CI = falsa confianza.

---

## 4. Hallazgos — resources / encode profiles

### 4.1 Bien: `encode-profiles.json` sí es la fuente única de datos

`resources/encode-profiles.json` es cargado en runtime por `main/encodeProfiles.js:1` (`import … with { type: "json" }`) y por `python/encode_profiles.py` (`_load_contract`, con cadena de fallback env `BERU_ENCODE_PROFILES` → `_MEIPASS` → project root). El `.spec` lo empaqueta (`beru-processor.spec:8-13`) y `package.json` lo declara en `extraResources` (l. 105-108). `tests/encode-profile-contract.test.js` verifica paridad JS↔Python lanzando Python real — el contract test correcto.

### 4.2 Pero la _lógica_ está duplicada en los dos lenguajes

- `VALID_PROFILES` hardcoded dos veces: `main/encodeProfiles.js:5` y `python/encode_profiles.py:11` (`{"fast","balanced","quality","uquality"}`).
- Default `"balanced"` dos veces: `shared/job-manifest.js:4` vs `python/encode_profiles.py:10`.
- `normalizeProfiles` (JS, 24 líneas) espeja `_normalize_profiles` (Py, 20 líneas) — mismo filtro, mismo default-check, distinto casing de claves (`allowsHardware`→`allows_hardware`, `hwCq`→`hw_cq`).

Consecuencia: añadir un perfil "cinema" al JSON es **silenciosamente descartado** por ambas capas (el `VALID_PROFILES.has(key)`/`key not in _VALID_PROFILES` filtra lo desconocido). El JSON no es auto-descriptivo: la lista de perfiles válidos debería derivarse de `Object.keys(raw.profiles)` o declararse en el propio JSON (`"validProfiles": [...]`). Hoy el contract test pilla la divergencia JS↔Python, pero nadie pilla JSON-vs-código hasta que el perfil nuevo "no aparece" en producción.

### 4.3 `python/encode_profiles.py` — 3 caminos de resolución + env override

`_encode_profiles_json_path` (l. 14-39) prueba `BERU_ENCODE_PROFILES` → `sys._MEIPASS/resources/` → `_MEIPASS/` → `project_root/resources/` → `project_root/`. Cinco candidatos para localizar un JSON de 29 líneas que el spec ya garantiza en `resources/`. El env override es razonable para desarrollo; el cuádruple fallback es defensivo sin test que lo cubra (¿alguien lo necesita?).

---

## 5. Hallazgos — scripts/

### 5.1 Emojis — violación de la propia HARD RULE del repo

`AGENTS.md` declara **"No emojis en código, UI, logs ni documentación"**. `release-loop.mjs` imprime ✅❌⏭️📦▶️📝🔗💥🚀⚡⚠️ℹ️🔁 en ~20 sitios (l. 49,53,59,141,205-218,248,269,289,336-372); `regression-guard.sh` añade 🔁📊✅❌ (l. 3,96,272,276,282). Regla del repo violada por sus propias herramientas de enforcement — mala señal de coherencia.

### 5.2 `release-loop.mjs` (382 líneas) — problemas concretos

- `runQualityGate` (l. 202-220) re-lista `lint`, `format:check`, `test`, `test:python` — la **tercera definición** del mismo gate (junto a `package.json` scripts y `verify.mjs` GATES). Debería ser `run("npm run verify")` — una línea — o el gate divergerá (ya lo hizo: verify existe y release-loop no lo usa).
- `run()` usa `execSync(cmd)` con strings de shell interpolados (l. 19-36). `gh release create ${tag} --title "${title}" --notes-file "${notesFile}" ${assets}` (l. 328) — el escape solo cubre `"` dentro de rutas (l. 324); un `(` o `&` en un path de `dist-installer` rompe el comando en `cmd.exe`. Ya importan `execFileSync` y lo usan una vez (l. 122) — inconsistencia: todo debería ser execFileSync con array de args.
- `runCapture` en modo `silent` devuelve `e.stderr` **como si fuera output** (l. 33) — los callers no distinguen fallo de éxito y funcionan por accidente (`gh auth status` falla → stderr no contiene "alphagiolabs" → `fail()` correcto por casualidad).
- `hasDate = entry.includes("- 20")` (l. 182) — validación de fecha frágil: matchea cualquier "- 20" en el cuerpo (p.ej. "- 20 items arreglados").
- `detectVersion` hace `gh release view` para comprobar que la release no existe — OK, pero la detección de duplicados se hace dos veces (tag local + release remota) con dos mecanismos distintos.
- En `createGitHubRelease` los assets se re-buscan en `dist-installer` (l. 316-326) duplicando el descubrimiento de `runBuild` (l. 243-253).

### 5.3 `regression-guard.sh` (284 líneas de bash en un proyecto Windows-first)

Además del Trigger B roto (§2.3): parseo de baseline con `grep -oP '\d+ passed.*\(\K\d+(?=\))'` sobre `tests-baseline.log` (gitignored → local-only, se salta silenciosamente si no existe — l. 153); `exec 3>&1 1>&2` para sobrevivir a bugs de stdout de Git-Bash (comentario honesto, pero síntoma de fragilidad acumulada); y `run_verify` solo se usa en Trigger E mientras Trigger A inlinea su propia copia con `tee`. Todo el archivo reimplementa lo que `npm run verify` ya hace, con triggers por archivo que han quedado desactualizados (nombres de tests inexistentes).

### 5.4 `test:python` — 28 comandos encadenados a mano

`package.json:18` lista 28 `python python/test_*.py` unidos por `&&`. Falla el primero → los demás no corren (sin reporte agregado). Y **ningún test verifica que todo `test_*.py` esté en la lista**: `python-test-wiring.test.js` comprueba que cada `def test_*` sea invocado _dentro_ de su archivo, pero no que el archivo esté en el script npm. Añadir `python/test_nuevo.py` sin tocar `package.json` = test que nunca corre en CI, silenciosamente. Un runner de 15 líneas con glob (o `python -m pytest` si se normaliza el estilo) lo elimina.

### 5.5 Menores

- `verify.mjs:34` — `spawnSync("npm", [...], { shell: true })` para el gate python mientras los demás gates usan `process.execPath` directo: correcto por necesidad en Windows, pero el comentario del propio archivo explica el porqué — bien documentado, aún así un `npm` shell-out es el punto débil.
- `build-processor.mjs:102` — `mkdirSync(build/pyinstaller)` crea un dir que el spec no usa (PyInstaller trabaja en `python/build`); probablemente vestigial.
- `fetch-ffmpeg.mjs` + `postinstall` (`package.json:26`) — `|| node -e "console.warn(...)"` traga **todos** los fallos: `npm ci` puede terminar sin `bin/ffmpeg.exe` y nadie se entera hasta que un test/main lo invoca. CI se cubre con el paso explícito `npm run fetch:ffmpeg` (workflow l. 44) — el postinstall debería fallar solo cuando realmente no hay binarios, no silenciar siempre.
- `dev.mjs` — razonable en general; `fs.watch(pythonDir, { recursive: false })` (l. 140) solo ve el top level (OK hoy, pero queda atado a la estructura actual) y su `RUNTIME_PROCESSOR_MODULES` es la tercera copia de la lista (§6).
- `benchmark-*.ps1` modificados sin commitear (`M` en `git status`) — WIP mezclado con tooling estable.

---

## 6. La lista de módulos Python triplicada (y los tests que la sostienen)

La misma enumeración de "módulos runtime de processor.py" existe en tres sitios:

| Lugar                               | Lista                           | Test que la vigila                     |
| ----------------------------------- | ------------------------------- | -------------------------------------- |
| `scripts/dev-python-watch.mjs:1-9`  | `RUNTIME_PROCESSOR_MODULES` (7) | `dev-python-watch.test.js`             |
| `scripts/build-processor.mjs:67-77` | `watchFiles` (7 + spec + json)  | `build-processor-watchfiles.test.js`   |
| `python/beru-processor.spec:23-30`  | `hiddenimports` (6)             | `processor-spec-hiddenimports.test.js` |

Los tres tests extraen los imports locales de `processor.py` con `tests/helpers/python-imports.js` y afirman cobertura. Es decir: **tres listas mantenidas a mano + tres tests cuya única razón de ser es que las listas están duplicadas**. La jugada correcta es una sola fuente — p.ej. que el `.spec` derive `hiddenimports` de los imports de `processor.py` (el helper ya lo hace) o un `python/RUNTIME_MODULES` consumido por los tres — y los tres tests desaparecen con la duplicación.

---

## 7. Hallazgos — config / CI

### 7.1 `eslint . --quiet` esconde 18 warnings reales

`npx eslint .` reporta **18 warnings**: 15 `react-hooks/exhaustive-deps` (dependencias ausentes/innecesarias — clase de bugs de stale-closure reales en `TableEditor`, canvas, hooks de preview) y 3 `no-unused-vars`. `npm run lint` = `eslint . --quiet` → el gate muestra 0 problemas. `AGENTS.md` afirma "ESLint ya avisa con `no-unused-vars`" — bajo `--quiet`, **no avisa de nada**. Decisión a tomar: o quitar `--quiet`, o promover `exhaustive-deps` a `error` (es la única regla que ahora mismo produce warnings con potencial de bug).

### 7.2 CI (`ci-release.yml`)

- `permissions: contents: write` a nivel top (l. 12-13) — el job `test` (que corre en cada PR) recibe write. Mínimo privilegio: `contents: read` arriba, `write` solo en `release`.
- Python tests corren **dos veces por release**: `npm run verify` en Ubuntu (l. 52, incluye gate `python`) y `npm run test:python` otra vez en Windows (l. 88). Mientras tanto los tests JS **solo** corren en Ubuntu — la asimetría es sospechosa: si la motivación es "ffmpeg real en Windows", el renderer/JS también se empaqueta en Windows y no se re-testea.
- `pip install --quiet numpy` ad-hoc en el step Verify (l. 51) — dependencia de test no declarada ni pinneada en ningún `requirements*.txt` (que no existe).
- `actions/checkout@v6` / `setup-node@v6` — verificar que v6 existe para `checkout` (a fecha de hoy checkout está en v4/v5; si el runner resuelve v6 como tag inexistente, el workflow está roto — validar).
- Sin `concurrency` — dos tags empujados juntos lanzan dos releases en paralelo.
- `upload-artifact` (l. 152-161) tras `electron-builder --publish always` — los mismos assets ya quedan en la GitHub Release; el artifact es backup redundante (barato, pero es duplicación).
- No hay workflow separado de quality gates para PRs de forks con secretos: el job `test` corre en `pull_request` sin `secrets.*` — bien, el build salta auth — pero `npm run verify` fallará por 2.1 hasta que `verify.mjs` se commitee.

### 7.3 `vitest.config.js` — jsdom global

`environment: "jsdom"` (l. 15) para los 143 archivos: la ejecución cronometrada muestra ~860 ms de environment setup por archivo de proceso principal/Python que jamás toca el DOM. Con `--environment node` por defecto y `// @vitest-environment jsdom` en los ~45 `.jsx`/DOM tests se ahorra tiempo de suite y se elimina la clase de bugs "test pasa porque jsdom existe" (los tests de `main/` no deberían tener `window` en absoluto — de hecho `store.logic.test.js` reemplaza `globalThis.window` por `{api}` destruyendo el window jsdom).

### 7.4 Dependencias

- `shadcn` (`^4.13.0`) en `devDependencies` — es el CLI de codegen de componentes; pinarlo como dep arrastra su árbol en cada `npm ci` para algo que se invoca una vez (`npx shadcn`). `components.json` se queda, el paquete puede salir.
- Resto del spot-check limpio: `radix-ui` (3 imports en `components/ui/`), `@tanstack/react-virtual` (2), `xlsx` (import dinámico en `batchSlice.js:254` — de ahí el `manualChunks.xlsx`, correcto), `electron-updater`, `supabase`, `clsx`/`tailwind-merge` todos usados.
- `ffmpeg-static`/`ffprobe-static` en devDeps — correcto (consumidos por `fetch-ffmpeg.mjs` postinstall).

### 7.5 `.gitignore` — dos problemas ya documentados + uno latente

Además de `/scripts/*` (§2.1) y `.githooks/` (§2.2): `.tmp/` no está en ignores ni en `.prettierignore` ni en `eslint.config.js` ignores — hoy solo contiene `.log` (cubierto por `*.log`), pero cualquier `.js`/`.md` que herramientas de auditoría depositen ahí entrará al lint/format.

---

## 8. Remediación propuesta (ordenada por impacto/riesgo)

1. **[Crítico, 30 min] Un solo gate, trackeado.** Quitar `/scripts/*` de `.gitignore` (o añadir `!/scripts/*.mjs`) y commitear `scripts/verify.mjs` **junto** al WIP que ya lo referencia — si se pushea `package.json`+workflow sin él, CI muere en el siguiente push. Decidir `regression-guard.mjs`: commitearlo con su referencia o borrarlo (hoy es archivo huérfano). Mejor aún: que `verify` ejecute las 4 puertas **en paralelo** (`spawn` async + `Promise.all`) — gate de ~4-6 min a ~2 — y que `release-loop.mjs` `runQualityGate` pase a `run("npm run verify")`. Borra ~20 líneas de release-loop y una divergencia garantizada.
2. **[Crítico] Decidir el destino de los hooks.** Si el Loop A importa: trackear `.githooks/` + documentar `git config core.hooksPath .githooks` en README/postinstall. Si no: borrar `.githooks/` y `regression-guard.{sh,mjs}` enteros — son 500+ líneas de tooling que solo corre en una máquina, con un trigger ya roto. CI ya cubre lo mismo con `npm run verify`.
3. **[Alto] Portar los tests de internals Python a `python/test_*.py`.** Los ~36 tests de `python.ffmpeg-path.test.js` que no tratan paths → `python/test_processor_internals.py` (o varios). Se conserva cada assertion (ya están escritas en Python dentro de los strings), corre en `test:python`, baja la suite JS ~10 s y elimina el harness `spawnSync`+`PY_CODE_PREFIX` de 8 archivos. El archivo queda con sus ~5 tests legítimos de resolución de paths.
4. **[Alto] Una lista canónica de módulos Python.** Derivar `hiddenimports` en el `.spec` de los imports de `processor.py` (ya hay extractor en `tests/helpers/python-imports.js`; moverlo a `scripts/` o reimplementarlo en 10 líneas de Python), y que `dev-python-watch`/`build-processor` lo consuman de un JSON compartido. Elimina 3 listas y 3 tests enteros.
5. **[Alto] Partir `store.logic.test.js` por slice** (`store.queue.test.js`, `store.processing.test.js`, `store.batch.test.js`, `store.update.test.js`, `store.project.test.js`) + extraer `makeQueueItem()` y `resetEditorState()` a `tests/fixtures/`. Los ~8 tests duplicados con `update-state`/`output-naming` se eliminan; el reset manual pasa a derivarse del estado inicial real del store (snapshot de `useEditorStore.getState()` tras import fresco).
6. **[Medio] Eliminar o convertir los ~24 grep-as-test.** Para cada uno: o se reescribe como test de comportamiento (mockear el módulo y ejercitar la función — ya lo hacen `job-worker.test.js`, `process-handler-run.test.js`), o se borra admitiendo que es una nota de auditoría, no un test. Empezar por `dev-script-listener-cleanup`, `audit-config`, `window-close-confirm`, `frontend-perf-audit`, `export-pipeline-facade:319-326`.
7. **[Medio] `eslint .` sin `--quiet`** o `exhaustive-deps: error`. Resolver/degradar conscientemente los 18 warnings actuales.
8. **[Bajo] `test:python` → runner con glob** (`scripts/test-python.mjs`, 15 líneas, lista `test_*.py`, agrega fallos y corre todo). Elimina la lista manual de 28 y el hueco de `python-test-wiring`.
9. **[Bajo] CI**: `permissions: read` + write solo en release; `concurrency: release-${{ github.ref }}`; decidir si los tests Python duplicados en Windows son intencionales (documentarlo) o borrar el paso.
10. **[Bajo] Quitar emojis** de `release-loop.mjs`/`regression-guard.sh` (o corregir AGENTS.md si la regla ya no aplica — pero la regla es HARD).

## 9. Lo que está bien (no tocar)

- `resources/encode-profiles.json` como contrato JSON único consumido por las dos capas, con test de paridad real.
- `resources/op-active-fixtures.json` / `text-layout-fixtures.json`: fixtures compartidos cross-language — el patrón a generalizar.
- `tests/helpers/python-imports.js` + los tests de cobertura de imports: buena idea, mal soportada (sostiene duplicación en vez de eliminarla).
- `verify.mjs` como concepto: un gate único y documentado — exactamente lo que falta commitear.
- `dev.mjs`: port-picking, prefixing de output, kill-tree en Windows — sólido.
- `beru-processor.spec` con `datas` explícito y guard de existencia del JSON.
- `tests/fixtures/job-manifest.js`, `updater-main.harness.mjs`: helpers compartidos reales, no boilerplate.
