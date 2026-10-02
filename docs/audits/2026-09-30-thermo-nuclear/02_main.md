# Auditoría termo-nuclear — `main/` (proceso principal de Electron)

**Fecha:** 2026-09-30 · **Alcance:** `main/` completo (58 archivos, 5.786 líneas), auditado sobre el worktree sucio tal como está. · **Método:** lectura exhaustiva de los 58 archivos + cruce de canales IPC (`shared/ipc-channels.js` ↔ `main/handlers/*` ↔ `main/preload.cjs` ↔ uso real en `src/`).

## Veredicto

El refactor en curso dejó la superficie IPC **notablemente más sana**: tabla única de canales, registro centralizado en `main.js:238-249`, seguridad descompuesta en `security/` con políticas bien nombradas, y un patrón de eventos con `runId` correcto. **Pero la capa de proceso/worker sigue siendo la parte más frágil del proceso main**: un handler de 215 líneas que mezcla 6 fases, dos implementaciones casi idénticas de worker persistente, cuatro reimplementaciones de "spawn + captura acotada + timeout", y un ciclo de vida de cierre repartido entre 4 archivos con ~7 flags booleanos. La base es buena; falta el segundo pase de judo.

## Mediciones

| Métrica                                             | Valor                                                                                 |
| --------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Archivos / líneas                                   | 58 / 5.786                                                                            |
| Canales `IPC_INVOKE` declarados                     | 50                                                                                    |
| Canales registrados vía `ipcMain.handle`            | 50/50 (sin huérfanos, sin literales sueltos)                                          |
| Canales expuestos en `preload.cjs`                  | 50 invoke + 10 subscribe + `getPathForFile`                                           |
| APIs expuestas sin consumidor en `src/`             | 0                                                                                     |
| Canales de evento `IPC_EVENTS`                      | 12, todos usados                                                                      |
| Implementaciones de worker persistente              | 2 (`job-worker.js` 231 l., `preview-frame.js` 256 l.)                                 |
| Implementaciones "spawn + buffer acotado + timeout" | 4 (`videoProbe.js:139`, `thumbnail.js:44`, `settings.js:72`, `processor-spawn.js:39`) |
| Loops de concurrencia limitada                      | 2 (`concurrency.js`, `process-input-validation.js:69-84` — duplicado)                 |
| Flags booleanos del ciclo quit/install              | 7 repartidos en 4 archivos                                                            |
| Variables de estado del updater                     | 8 (`updater.js:7-17`)                                                                 |
| Estado auth/supabase en main                        | Ninguno (vive íntegro en el renderer) — correcto                                      |
| `execution-history` residual                        | 0 referencias — eliminación limpia                                                    |

## Mapa IPC — drift

**Sin drift.** Las 50 claves de `IPC_INVOKE` tienen handler registrado, entrada en preload y consumidor en `src/`. No quedan canales con string literal (`ipcMain.handle("...")` = 0 coincidencias). El test `tests/preload-subscriptions.test.js` mantiene la paridad preload↔tabla. `handlers/execution-history.js` y `main/utils/execution-history.js` fueron borrados sin dejar referencias colgadas. Esto es lo mejor del refactor.

## Hallazgos (ordenados por severidad)

### ALTA

**A1 — `handlers/process.js`: un handler de 215 líneas que es una pipeline entera.** `ipcMain.handle(IPC_INVOKE.startProcessing)` (L104-318) encadena en un solo cuerpo: unwrap del manifiesto → validación de procesador → validación de binarios → output dir → `sanitizeJobMedia` → `findUnreadableInputsAsync` → `startRun` → artefactos → drain del media pool → enriquecimiento con probe → escritura del manifiesto → lectura de settings → `startJobRun` → cableado de `close`/`error`/`done`. Hay 4 guardas idénticas `if (!run.isCurrent() || getAppIsQuitting()) return settleCancelled()` (L175, 188, 196), tres closures anidadas (`settleCancelled`, `onClose`, `onError`) y un `new Promise` manual que hace de race entre `close` y `jobRun.done` (L298-311). Orquestación y política van en el mismo bloque; el resultado correcto depende del orden de ~15 awaits.

_Judo propuesto:_ extraer dos funciones — `prepareRunJobs(payload, pathSecurity)` (todo hasta escribir el manifiesto: devuelve `{enrichedJobs, manifestPath}` o un error) y `watchJobRun(run, jobRun)` (todo el cableado close/error/done). El handler queda como ~40 líneas lineales de pipeline. Los chequeos de pre-vuelo (`validateProcessorAvailableAsync` y `findUnreadableInputsAsync`) son independientes y pueden correr con `Promise.all` — hoy son secuenciales.

**A2 — Dos workers persistentes casi idénticos + cuatro spawn-capture.** `utils/job-worker.js` y `utils/preview-frame.js` reimplementan el mismo ciclo de vida: `worker`/`workerReady`/`workerStartPromise`/`nextRequestId` globales, spawn con `buildProcessorChildEnv`, línea `ready` de handshake, request por stdin con `MAX_REQUEST_BYTES`, settle por línea con `id`, `stderrTail`, `killWorker`/`stopWorker`/`dispose` (comparar `job-worker.js:72-188` con `preview-frame.js:99-204`: ~60% de paralelismo estructural). Además hay 4 variantes de "spawn + captura acotada + timeout": `videoProbe.js:139-197`, `thumbnail.js:44-103`, `settings.js:72-111`, `processor-spawn.js:39-65`.

_Judo propuesto:_ un `createLineWorker({spawnArgs, env, onMessage, timeoutMs})` genérico que devuelva `{send(obj), onLine, done, dispose}`; ambos workers quedan en ~80 líneas cada uno. Y un `runCapturedProcess(cmd, args, {timeoutMs, maxStdout, maxStderr})` único que absorbe las 4 copias. Ahorro estimado: ~250 líneas y una sola fuente de bugs de EPIPE/timeout.

**A3 — El ciclo de vida "quit" vive en 4 archivos con ~7 flags.** `main.js:34-38` (`quitCleanupStarted`, `quitDisposalDone`, `quitRequested`, `fatalHandling`, `writingDiagnostic`), `shared-state.js:9` (`_appIsQuitting`), `updater.js:16-17` (`quittingForUpdate`, `updateDownloaded`) y `window.js:65` (`closeConfirmed`). Además `interceptQuitIfProcessing` se registra **dos veces** (`will-quit` L155 y `before-quit` L230) y `window.js:66-95` implementa una segunda compuerta de quit con diálogo de confirmación — que solo se ofrece al cerrar la ventana: `Cmd+Q`/`app.quit()` cancela el procesamiento **sin preguntar** (UX inconsistente). `interceptQuitIfProcessing` pone `quitRequested = true` antes de saber si el quit se va a abortar (L136-137).

_Judo propuesto:_ un único `quit-orchestrator.js` con una máquina de tres estados (`running → cancelling → quitting`) que consulte `hasActiveProcessing()` e `isQuittingForUpdate()`; `will-quit`/`before-quit`/close delegan en él. Colapsa 7 flags en 1-2 y elimina la duplicidad de compuertas.

**A4 — `updater.js`: máquina de estado manual con 8 variables sueltas.** `initialized`, `lastSnapshot`, `pendingVersion`, `checkInProgress`, `downloadInProgress`, `downloadBusy`, `quittingForUpdate`, `updateDownloaded` (L7-17). `downloadInProgress` vs `downloadBusy` existen solo porque el loop de reintentos (L201-227) apaga uno entre intentos — el comentario de L13-14 confiesa el hack. En `checkForUpdates`, `if (pendingVersion && !downloadInProgress)` (L125) tiene una condición muerta: `downloadInProgress` ya retornó en L124. `autoInstallOnAppQuit = false` se escribe tres veces (L60, L91, L114) y **nadie lo pone a `true` jamás** — tres escrituras muertas. `scheduleInstall` tiene doble desbloqueo (catch de `quitAndInstall` y `setTimeout` de gracia L263-272) que puede emitir `error` mientras la app ya está cerrando.

_Judo propuesto:_ reemplazar por un estado único `status ∈ {idle, checking, available, downloading, ready, installing}` + `pendingVersion`/`lastSnapshot`. Los flags `checkInProgress`/`downloadInProgress`/`downloadBusy`/`updateDownloaded`/`quittingForUpdate` son todos derivables del estado. Borrar las escrituras muertas de `autoInstallOnAppQuit`.

### MEDIA

**M1 — Contrato de error IPC inconsistente, sin wrapper canónico.** Conviven cuatro formas: `{success:false,error}` (la mayoría), `{ok:false,error}` (video.js L100, preview-frame), throw desnudo que llega como rechazo al renderer (video.js L41, L75 `throw new Error("Demasiados videos…")`), arrays crudos (`recent.js` L8-11 devuelve `list.map` sin envolver), `null` (`getThumbnail`), y `{canceled:true}` (dialog.js L61, project.js L25). `petdex.js:11-19` ya inventó su propio `wrapPetdex` — la señal de que falta la abstracción. `handlers/updater.js` no captura nada.

_Judo propuesto:_ `handle(channel, fn)` en un `utils/ipc.js` que envuelva `ipcMain.handle` con try/catch → `{success:false, error}` y log uniforme. Colapsa ~20 bloques try/catch repetidos (99 coincidencias de `catch|success:false` en `handlers/`).

**M2 — Doble estrangulamiento en `handlers/video.js`.** `getVideoInfoBatch` calcula `limit` con `os.cpus()` (L22-23) y corre `runWithConcurrency` sobre tareas que **ya pasan por `runMediaTask`** (pool compartido con su propio `capacity()` dinámico por RAM, `media-task-pool.js:21-33`). El límite externo es redundante: el pool ya regula. Idéntico en `getThumbnailBatch` (L77-86) y `extractFilmstrip` mete 4 ffmpeg dentro de **un solo** slot del pool (`thumbnail.js:160-162` + `FILMSTRIP_FRAME_CONCURRENCY=4`) — el pool cree que hay 1 tarea activa mientras hay 4 procesos ffmpeg; subvierte su propio modelo de capacidad.

**M3 — `findUnreadableInputsAsync` reimplementa `runWithConcurrency`.** `process-input-validation.js:69-84` tiene su propio cursor+`Promise.all` de N workers — idéntico al helper de `concurrency.js` que ya existe. Y `process.js` hace **dos pasadas** sobre los jobs: primero stat+open de cada input (L135) y luego ffprobe de cada uno (L180-186); `probeVideoFile` ya hace `existsSync` internamente — la primera pasada podría fusionarse con el probe o al menos solaparse.

**M4 — `run.lastError` como canal lateral.** `process.js` escribe `run.lastError` desde `dispatchProcessorLine` (L55) y lo lee en `onClose` (L264) para reconstruir el mensaje del exit code — estado mutable compartido entre el parser NDJSON y el teardown, con `run.settle(result, teardown)` cuyo segundo parámetro solo usa un call site (`cleanupChildListeners`, L241). Funciona, pero es el patrón "variable global de la run" que el refactor debería haber eliminado.

**M5 — `BERU_ENCODE_PROFILE` usa solo `jobs[0]`.** `process.js:198` toma `enrichedJobs[0]?.encode_profile` para el env de todo el run; pero Python ya calcula el perfil efectivo del lote mirando **todos** los jobs (`processor.py:2652-2671`) y lee `encode_profile` por job (L2288). El env es, en el mejor caso, redundante y, con perfiles mixtos, engañoso.

**M6 — `grantedReads`: consentimiento "pegajoso" no documentado.** En `security/consent.js:18-27`, `grantRead` solo se llama tras pasar `inspectReadableFile`, que ya exige `canRead` (consentimiento **o** trusted root, `path-verdicts.js:47`). Consecuencia: un grant por archivo nunca amplía el acceso en el momento de crearlo — solo lo hace "pegajoso" si luego cambia el output dir. Es un invariante sutil que el código no nombra; un lector razonable concluiría que el Set es peso muerto (2.000 entradas + `trimOldest`) o, peor, que es la frontera de seguridad (no lo es: la frontera real es `isUnderRoot` + output dir).

**M7 — Polaridad invertida dos veces en thumbnails.** El renderer envía `{visible: !interactive}` (`queueSlice.js:185`) y main traduce `interactive: options?.visible !== true` (`video.js:66-69`). Dos negaciones que cancelan: funciona, pero "visible" significa cosas opuestas en cada lado. Un `priority: "high"|"normal"` eliminaría la doble inversión.

**M8 — `waitForMediaTasksToDrain` no drena a cero.** `media-task-pool.js:108-111` resuelve cuando `active <= capacity()` — durante processing `capacity()` es 2, así que "drain" significa "hasta 2 activas", no "vacío". El nombre promete más de lo que hace; el call site (`process.js:174`) se apoya en esa promesa.

### BAJA

- **B1** — `main.js:94-116` `mainStackFrames`: 23 líneas de parseo de stack para loguear 2 frames; la regex `\.m?js$` (L110) excluye `preload.cjs` — justo un archivo que puede crashear. Simplificable a un `match` sobre las primeras líneas del stack.
- **B2** — `dispatchProcessorLine` traduce `error:"Cancelled"` por comparación de string (L45-49): Python emite `type:"error"` donde debería emitir `type:"cancelled"`. Contrato de wire frágil — un error legítimo con ese texto se convierte en cancelación.
- **B3** — `getVideoInfo` traga el error del probe y devuelve `{exists:true, width:0…}` (video.js L33-35): el renderer no distingue "probe falló" de "video sin dimensiones".
- **B4** — Escrituras no atómicas inconsistentes: `preset.js:54` (`writeFileSync` directo) y `petdex-fs.js:64` (`writeManifestCache`) no usan `writeJsonAtomic` que sí usan settings/recent.
- **B5** — `installPet` hace `listInstalledPets()` dos veces por instalación (`petdex.js:41` y L45): dos escaneos síncronos de disco de todas las mascotas.
- **B6** — Dead code disperso: `Array.isArray(ws)` en `excel.js:23` (una worksheet de `XLSX.read` nunca es array), `zipUrl` normalizado en `petdex-core.js:56` sin consumidor en todo el repo, cláusula `real !== dirReal` en `preset.js:77` (un archivo nunca resolve al dir), `Number.isInteger(message.id)` en preview-frame acepta líneas `ready` ya consumidas.
- **B7** — `MAX_BATCH_PATHS = 500` (video.js:13) duplica `MAX_FILES_PER_DROP = 500` (drop-resolver.js:5) con un comentario que admite la sincronía manual — exportar la constante compartida.
- **B8** — `hasVideoOperations` (process.js:63) miente: comprueba `operations.length > 0`, no "operaciones de video".
- **B9** — `pickImage`/`readImage` viven en `file.js` siendo handlers de diálogo (hay `dialog.js`); `handlers/updater.js` mezcla `async`/`await` innecesarios (L9 `return await`) con returns síncronos.
- **B10** — `updater.js:37` hace `win.webContents.send` directo en vez de `sendToRenderer` (la única excepción al canal centralizado).
- **B11** — `beru-protocol.js` statCache con TTL 5s: un output reescrito <5s sirve `Content-Length`/`Content-Range` obsoleto. Bajo riesgo (los outputs se consumen tras `finished`), pero la posibilidad existe.
- **B12** — `getCodexPetsRoot` (`petdex-fs.js:14-19`) lee `~/.codex/pets` — acoplamiento con un producto externo; `BERU_CODEX_PETS_ROOT` como override. Decisión de producto, pero huele a vestigio de otra app.
- **B13** — `listPresets` devuelve `userDir` al renderer (preset.js:20): fuga de ruta interna innecesaria.
- **B14** — `writeExcel` mueve hasta 25 MB en base64 por IPC (file.js:43-44) — ~33 MB de string por el puente; hay límite, así que es aceptable, pero un write por path con capability + stream sería más barato.
- **B15** — `pathSecurity.js` es un adaptador de 9 funciones sobre 5 sub-módulos — bien hecho, pero `approve` devuelve `{ok:false}` sin `error` (write-capability.js:11), rompiendo el shape del resto de verdicts.
- **B16** — `workerPolicy.js` duplica a mano la matemática de RAM de `processor.py` (documentado en L12-14). Drift garantizado a medio plazo; una tabla JSON compartida en `shared/` la eliminaría.
- **B17** — `parseFfmpegOutput`/`parsePixFmt`/`channelLayoutMap` (videoProbe.js:55-137): parser ad-hoc del texto de ffmpeg como fallback cuando ffprobe falla — frágil por diseño, aunque acotado al fallback.
- **B18** — `excel.js:15-53` reimplementa internals de `sheet_to_json` (`make_json_row`) para hallar la fila de cabecera — espejo de librería que se romperá en silencio con un upgrade de `xlsx`.
- **B19** — `petdex-https.js` está bien (allowlist de host, cap de 5 MB, 5 redirects, timeout 30s), pero `fetchPetBuffer` no fija `Content-Type`/límite por recurso — pet.json y spritesheet comparten el mismo cap de 5 MB.
- **B20** — `media-task-pool.js` dedup por `key` re-encola con splice+push (L71-81); correcto, pero el pool entero es una reimplementación de una cola de prioridad con dedup — candidato a simplificar si crece otro consumidor.

## Remediaciones concretas (orden de impacto)

1. **`utils/line-worker.js` + `utils/run-captured.js`** — absorbe A2. Ambos workers pasan a ~80 líneas; las 4 capturas de spawn a 1.
2. **Extraer pipeline en `handlers/process.js`** — A1: `prepareRunJobs()` + `watchJobRun()`; el handler queda en ~40 líneas y los 4 guardas idénticos desaparecen.
3. **`quit-orchestrator.js`** — A3: una compuerta única, un flag, mismo diálogo en todas las rutas de quit.
4. **Estado único en `updater.js`** — A4: `{status, pendingVersion, snapshot}`; borra 5 flags y las escrituras muertas.
5. **`utils/ipc.js` con `handle()`** — M1: contrato `{success,error}` uniforme, log centralizado; `wrapPetdex` y los ~20 try/catch ad-hoc se evaporan.
6. **Eliminar el throttle externo en video.js** — M2: `runMediaTask` ya regula; `runWithConcurrency` por fuera es ruido.
7. **Una sola pasada sobre jobs** — M3: fusionar legibilidad + probe, o usar `runWithConcurrency` en `findUnreadableInputsAsync`.
8. **Eliminar `BERU_ENCODE_PROFILE` o calcularlo del set completo** — M5.

## Lo que está bien (no tocar)

- `shared/ipc-channels.js` + test de paridad preload↔tabla: la centralización correcta que el punto M1 debería extender a errores.
- `security/` (resolver/location/consent/verdicts/write-capability): descomposición limpia, invariantes en comentarios, `resolveSafeUncached` con fallback de ancestro real es correcto.
- `cancel-artifacts.js`: mkdtemp + sentinel `.cancel`, único lugar que conoce el layout — buen encapsulamiento.
- `emitRunEvent` con `runId` estampado y `RUN_SCOPED_CHANNELS`: patrón correcto para descartar eventos zombie.
- Watchdog de processing-run, one-shot write capabilities, `beru://` con intersección ext↔content-type y `corsEnabled:false`.
- `media-task-pool.js`: pool con 3 prioridades + dedup por key + drainWaiters — sobrio para lo que hace.
- Cero auth/supabase en main (todo en renderer); cero residuos de `execution-history`.
