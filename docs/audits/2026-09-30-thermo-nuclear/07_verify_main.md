# 07 — Verificación del refactor de `main/` (post-cambio)

Fecha: 2026-09-30 · Alcance: equivalencia observable del refactor de `main/` (line-worker, run-captured, handleIpc, split de process.js, state machine de updater, quitPhase, retirada de BERU_ENCODE_PROFILE). Revisión de solo lectura: tests ejecutados, diffs contra HEAD inspeccionados, sin modificar fuentes.

## Veredicto

**PASA con observaciones.** Los 29 archivos de test solicitados pasan (166/166 tests). El contrato IPC se mantiene exacto, la semántica del ciclo de vida de workers se preserva y el borde de proc obsoleto que el agente afirmaba arreglar está efectivamente corregido sin romper el cierre normal. Hay divergencias intencionales y menores, enumeradas abajo con file:line; ninguna rompe el contrato observable salvo una: `autoInstallOnAppQuit` ya no vuelve a `true` tras descargar — es un cambio de política fijado por test (`tests/updater-install-policy.test.js:15`).

## Resultados de tests

```
npx vitest run <29 archivos listados>
Test Files  29 passed (29) · Tests 166 passed (166) · 41.96s
```

Incluye: job-worker (7), preview-frame (8), preview-worker-output-limit (4), process-_ (input-validation 12, handler-run 5, run-scoped-events 5, cancel-ownership 7, cancel-output-cleanup 16, double-signal 1, media-validation 3, output-security 2), processing-cancel-state (3), processing-lock-watchdog (7), main-crash-diagnostics (5), main-fatal-kill-process-tree (4), main-quit-during-probe (10), main-quit-update (2), updater-_ (cancel-before-install 3, install-policy 1, event-race 5, flow 3), update-state (7), update-errors (3), shell-handlers (2), video-handler-security (4), main.videoProbe (3), petdex-handlers (9), batch-process (12), batch-runner (13).

## 1. Contrato IPC — OK

- `shared/ipc-channels.js`: 51 entradas `IPC_INVOKE` = 51 registros verificados en `main/` (script de auditoría en `.tmp/ipc-audit.cjs`): **cero duplicados, cero canales sin registrar, cero registros fuera del catálogo**. 13 `IPC_EVENTS` = 13 `subscribe()` en `preload.cjs`; 51 `invoke()` = 51 canales. Ningún `sendToRenderer`/`webContents.send` usa canal literal fuera de `IPC_EVENTS` (main/utils/renderer.js:3, updater.js:34, handlers/video.js:130, utils/pet-overlay.js:20,27).
- Eliminados coherentemente (sin consumidores en `src/`, documentados en `docs/dead-code-audit.md`): `executionHistory:*` (handler+util borrados), `shell:openExternal`, `petdex:uninstall`, `process:exportLogs`, `process:log` (`api.onLog` y `useProcessing.onLog` retirados).
- `handleIpc` (main/utils/ipc.js:3-12) reproduce la forma `{success:false, error}` de los try/catch inline que reemplazó (recent.js, preset.js save/delete, project.js save/load, settings.js save, file.js, petdex.js — que ya usaba `wrapPetdex` idéntico —, pet-overlay.js, process.js). Handlers NO envueltos (video.js, dialog.js, system.js, updater.js, drop.js, `recent:list`, `project:loadFromPath`, `session:restorePaths`, `settings:load`) conservan sus return shapes.
- Excepciones de shape verificadas contra consumidores: `fs:readExcel` ahora devuelve `{success, rows, headers}` en vez de base64 (`batchSlice.js:291-299` consume `rows/headers` — actualizado en tándem); `fs:writeExcel` exige `consumeWritePath` (file.js:33) — satisfecho porque `exportExcel` pasa por `saveExcelDialog` primero (dialog.js:62 registra la ruta; batchSlice.js:249-271); `system:getBatchCapacity` pierde `maxWorkersCap` — sin consumidores en src/; `shell:showItemInFolder` añade guardia existsSync — aditiva; `process:start` añade `code:"already_processing"` (handlers/process.js:259) — aditivo, consumido por `batch-runner.js:5` y `store-errors.js:6`.
- Nuevo `throw` en `getVideoInfoBatch`/`getThumbnailBatch` >500 paths (handlers/video.js:34,75): el invoke **rechaza** (no `{success:false}` — no pasan por handleIpc); consumidores toleran rechazo (`processingSlice.js:134`, `queueSlice.js:215` `.catch(()=>{})`).
- Renderer: `useProcessing.js` filtra todos los eventos por `msg.runId` vs `activeProcessRunId` (líneas 62-66) — compatible con `emitRunEvent` que añade `runId` a todo payload (ipc-channels.js:83); eventos sin runId pasan (no-stale), igual que antes.

## 2. Ciclo de vida del worker — OK (+1 bug arreglado)

Comparación `preview-frame.js` viejo (HEAD) vs nuevo `line-worker.js` (44-198):

- Handshake `ready` idéntico (10s preview / 30s job), `ready.ok=false` → rechazo; **diferencia**: el viejo dejaba el proc zombie vivo tras ready-fail (preview-frame.js viejo: failStartup sin kill); el nuevo hace `stop()` → `killProcessTree` (line-worker.js:104-107, 88-94) — corrige la fuga sin afectar el camino normal.
- Buffer de líneas: viejo sin límite; nuevo `maxPendingLineBytes` por línea y por buffer (6MB preview, 256KB job) → overflow → `stop` con `OUTPUT_LIMIT_ERROR` — endurecimiento fijado por preview-worker-output-limit.test.js.
- EPIPE stdin: `proc.stdin.on("error")` → failStartup + `stop(outcomeFor("stdin"))` = `"Preview worker se cerró"` / `"El motor…"` — mismo efecto que el viejo.
- Timeout por request 60s: viejo mataba proc + settle solo ese request; nuevo `stop()` → settle de TODOS los pendientes de ese proc con el mismo outcome — mensaje de error difiere para requests no activos (`"Timeout…"` vs `"...finalizó (exit N)"`), misma forma `{ok:false,error}`.
- **Fix stale-proc confirmado**: `settleWorkerRequests` ya no llama `clearRequestQueue()` (preview-frame.js:38-42). En el viejo, un `close` tardío del worker A tras respawn de B vaciaba `queuedRequestId` dejando el request de B huérfano en `pending` para siempre. Ahora `settleRequest` solo limpia ids propios y `dispatchQueuedRequest` autocura ids obsoletos (líneas 76-79). El camino de cierre normal no se rompe: dispose → `settleAll` + `dispose` idempotente.
- `ensure()` coalescing por `workerStartPromise`, `isUsable`, `flushRemainder` (resto del buffer sin `\n` se entrega a `onLine` — equivale al `stdoutBuf` residual del viejo, que despachaba el remanente en close; job-worker lo usa, preview no — igual que antes).
- Carrera estrecha revisada: `watchJobRun` registra `proc.once("close")` en la misma cadena de microtareas tras `startJobRun` (handlers/process.js:285-308); `close` no puede emitirse en ese hueco (I/O macrotask), y si el worker ya murió, `close` se emite una vez para todos los listeners en el mismo pass — sin hang; aun así el watchdog de 5 min queda como red (processing-run.js:31-53).

## 3. `runCapturedProcess` — paridad verificada por sitio

- `videoProbe.js:145-151` (`runProcess`): mismo `windowsHide`, timeout→kill+`timedOut`, `error`→`{code:null,error}`, spawn-throw→`{code:null,...}`. **Nuevo**: caps 1MB stdout/256KB stderr con `outputExceeded` → tratado como vacío (videoProbe.js:162-177) — el viejo acumulaba sin límite; endurecimiento deliberado.
- `thumbnail.js:52-84`: cap 4MB stdout equivale al viejo `finish(null)` al exceder; `stderrMode:"drain"` ≡ viejo listener no-op; `signal` AbortSignal nuevo (aditivo); 5s timeout igual. Salida gana `width/height` (aditivo; consumidores leen `dataUrl`).
- `settings.js:72-81` (`readFfmpegEncoders`): 15s igual; 1MB+truncate aditivo; concat stdout+stderr cambia de intercalado a secuencial — parser es por líneas (`pickHwEncoderFromEncodersText`), equivalente.
- `processor-spawn.js:38-47`: `capture:false` → `stdio:"ignore"` idéntico; timeout 5s igual; mensajes de error iguales.
- Consecuencias: `runMediaTask` con dedup por `key` sustituye a `pendingThumbnails` (media-task-pool.js:104-120) — dedup equivalente; pool añade cap de concurrencia+memoria y estrangula durante procesamiento (`setMediaProcessingActive`). Caches: `trimOldest` ≡ viejo trim FIFO. Eliminados caches gated por env (`BERU_SETTINGS_CACHE`, `BERU_PROCESSOR_SPAWN_CACHE`) — solo perf.

## 4. `updater.js` state machine — OK con divergencia intencional

Mapeo viejo→nuevo completo: `checkInProgress`→`"checking"`; `downloadInProgress`→`"downloading"`; `downloadBusy&&!downloadInProgress`→`"retrying"`; `updateDownloaded`→`"ready"`; `quittingForUpdate`→`"installing"`; `pendingVersion` suelto→`"available"`; resto→`"idle"`. Ninguna combinación alcanzable queda irrepresentable; payloads de eventos (`type`, `version`, `percent`, `message`, `releaseNotes`, `releaseUrl`) intactos; `isQuittingForUpdate()` ≡ `status==="installing"` (main.js:137).

- **DIVERGENCIA-1 (intencional, test-pinned)**: el viejo `au.autoInstallOnAppQuit = true` en `update-downloaded` (HEAD updater.js:107) se eliminó; queda `= false` en init (updater.js:57). Antes, salir de la app tras la descarga instalaba silenciosamente; ahora solo instala la modal vía `quitAndInstall(false,true)`. Coherente con el comentario "oneClick:false cannot silent-install" y fijado por `updater-install-policy.test.js`.
- **DIVERGENCIA-2 (edge, inalcanzable en práctica)**: durante `"installing"`, `checkForUpdates` devuelve `pending-update` (no `already-ready`) y `startDownload` iniciaría una descarga — el viejo devolvía `already-ready`/`already-downloaded`. Solo si el renderer llama tras pulsar instalar mientras la app ya está saliendo.
- `update-available` con versión distinta durante `"installing"`: viejo ponía `updateDownloaded=false` (rompía el `install()` pendiente); nuevo conserva `"installing"` — es un fix, no una regresión.
- Retry loop: `downloading→retrying→downloading` y salida `→available|idle` equivalen a `downloadInProgress`/`downloadBusy` viejos; evento `error` de electron-updater mapea igual (downloading→retrying; checking→available|idle).

## 5. Ciclo de vida de quit — OK

- Ambos hooks retenidos: `before-quit` (main.js:222) y `will-quit` (main.js:153) llaman `interceptQuitIfProcessing`; tests main-quit-during-probe (10) y main-quit-update (2) los fijan y pasan.
- `quitPhase`: `running→quitting→cancelling→disposed` cubre las combinaciones viejas: `quitCleanupStarted`≡`"cancelling"`, `quitDisposalDone`≡`"disposed"`. Sin doble disparo: segunda invocación vuelve temprano por `cancelling||disposed` (≡ viejo `if(quitCleanupStarted)return`). Con procesamiento activo: preventDefault + `setAppIsQuitting` + `cancelRun().finally(dispose→quit)` — idéntico al viejo `cancelActiveProcessing`.
- Confirmación de cierre de ventana intacta (utils/window.js:79-88: diálogo → `cancelRun()` → `closeConfirmed` → destroy).
- Fatal: `Promise.resolve(killProcessTree(proc)).catch(()=>{})` en main.js:127 — confirma el cambio descrito; `fatalHandling` evita reentrada (el viejo podía re-entrar por throw dentro del handler); crash.log ahora con cap 64KB (rotación por truncado) y frames sanitizados.
- `window-all-closed` → `quitPhase="quitting"` + `app.quit()` (main.js:215-220) — mismo flujo.

## 6. Split de `process.js` — OK

- Orden de fases intacto: validate (processor+media+outputDir) → sanitize → unreadable → `prepareRunJobs` (artifacts → drain media-tasks → probe `runWithConcurrency` con `isCurrent` guard → `setProbePhase(false)` → write manifest) → `startJobRun` → `attachProcess`+`snapshotOutputs` → `watchJobRun`. `run.isInterrupted()` ≡ viejo `!isCurrentRun()||getAppIsQuitting()` (processing-run.js:71).
- `code:"already_processing"` presente (handlers/process.js:259), mensaje español idéntico.
- Eventos en los mismos puntos: `onRunStarted` tras adquirir el run (línea 262), `onFinished` en close/cancel (148-173), `onError` en error de proc/spawn (184-186, 302), `onSummary/onProgress/...` por línea NDJSON — todos ahora con `runId` (filtrado renderer ya implementado).
- Cancel: `cancelRun` (processing-run.js:186-205) replica la secuencia vieja — marca `.cancel` (artifacts.markCancelled → `manifest.cancel`; python lo descubre vía `splitext(jobs_file)+".cancel"` — batch_context.py:40, rutas coherentes con cancel-artifacts.js:9), grace 1500ms → killProcessTree → escalate → cleanupIncompleteOutputs → finished → settle. Extra: killProcessTree también tras exit en grace (reapa hijos) — aditivo.
- `snapshotOutputs` key=`job.id||index` coincide con `job.get("id", i)` de python (processor.py:372) — equivalente y más robusto que el índice posicional viejo.
- Arquitectura nueva: worker python persistente `--job-worker` (job-worker.js) en vez de spawn por run. Protocolo verificado E2E: ready→`{id,jobs_file,env}`→`run_end` (processor.py:1017-1065; env por request con borrado de claves previas — 1048-1054); cap de request 64KB alineado (JS job-worker.js:7 == python processor.py:146).
- `run.settle` idempotente con `settled` flag; `cleanupArtifacts` doble-seguro.

## 7. `BERU_ENCODE_PROFILE` — retirada correcta

- Python resuelve el profile por job: `encode_profile = job.get("encode_profile","balanced")` (processor.py:487) y agregado por prioridad uquality>quality>balanced>fast (processor.py:786-795) con env solo como fallback cuando NINGÚN job define profile — en ese caso el env viejo era `jobs[0]?.encode_profile||"balanced"` = "balanced" = el fallback python. La escritura era un no-op; quitarla no cambia la selección.

## Divergencias / notas menores

| #   | Tipo           | Detalle                                                                                                                                                                                                                                                      | Severidad                                            |
| --- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| 1   | Intencional    | `autoInstallOnAppQuit` ya no vuelve a true tras download — sin auto-install al salir (updater.js:57; fijado por test)                                                                                                                                        | Media — cambio de comportamiento real aunque deseado |
| 2   | Intencional    | `presets:list` ya no incluye presets bundled (resources/presets/\*.json borrados del repo)                                                                                                                                                                   | Media — feature retirada                             |
| 3   | Endurecimiento | Caps nuevos: batch ≤500 paths (throw), preview línea ≤6MB, probe stdout ≤1MB, request worker ≤64KB/1MB                                                                                                                                                       | Baja — tests cubren                                  |
| 4   | Edge           | updater durante `"installing"`: checkForUpdates→pending-update, startDownload iniciaría descarga                                                                                                                                                             | Baja — ventana de salida                             |
| 5   | Menor          | `enrichJobVideoInfo` siempre prueba salvo flag `video_info_probed` (viejo saltaba con metadatos completos) — mitigado por caché de probe; defaults de `applyProbeInfoToJob` pueden quedar `undefined` en vez de 0/"yuv420p" (python usa `.get` con defaults) | Baja                                                 |
| 6   | Menor          | `probeLimit` mínimo 1→2; `petMovement` default "fijo"→"fixed" (normalizePetMovement en types.js:166 los equipara); stderr de requests no-activos cambia de texto                                                                                             | Cosmética                                            |
| 7   | Arquitectura   | Thumbnails/previews ahora pasan por media-task-pool (estrangulados durante processing; `waitForMediaTasksToDrain` antes del probe) — comportamiento nuevo deseado                                                                                            | Baja                                                 |

## Limitaciones

- `main/utils/job-worker.js` es archivo nuevo sin baseline git; la paridad se verificó contra la semántica descrita, los tests (job-worker.test.js, process-_, processing-_) y el contrato python (`test_job_worker.py`, `job_worker_main`).
- No se ejecutó la app real (Electron) ni `npm run test:python`; verificación estática + suite vitest solicitada.
