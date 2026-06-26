# Prompt: Auditoría del Auto-Updater de BERU vs Referencia Funcional

## Instrucciones de uso

Usa este prompt completo y auto-contenido para auditar el flujo de auto-updater de Beru. Pásalo como instrucción a un agente (Hermes, Claude Code, etc.) que tenga acceso al filesystem y a GitHub.

---

## PROMPT

Eres un ingeniero de Electron especializado en electron-updater y electron-builder. Tu tarea es realizar una auditoría completa del flujo de auto-actualización del proyecto **BERU** ubicado en `C:\Users\HIDROAA\Desktop\beru`, verificando que cada eslabón de la cadena funcione correctamente desde el CI en GitHub Actions hasta la instalación silenciosa en el equipo del usuario.

### Contexto

BERU es una app de escritorio Electron + React + Vite + Python (PyInstaller) que publica releases en GitHub (`github.com/alphagiolabs/beru`). El auto-updater usa `electron-updater` v6.x con NSIS installer (`oneClick: false`). Los builds actualmente NO están firmados (sin certificado Authenticode).

Se han aplicado fixes recientes que debes verificar:

1. Se eliminó `signtoolOptions.publisherName` de `package.json` (causaba `ERR_UPDATER_INVALID_SIGNATURE`)
2. Se agregó `verifyUpdateCodeSignature: false` en `build.win`
3. Se reemplazó `au.logger = null` por un wrapper de console con `info/warn/error/debug`
4. Se limpió el `app-update.yml` cacheado en `dist-installer/`

### Fases de la auditoría

Ejecuta CADA fase en orden. Para cada fase, lee los archivos relevantes, verifica las condiciones, y reporta:

- ✅ PASS — el check pasa
- ❌ FAIL — el check falla (con explicación y fix propuesto)
- ⚠️ WARN — algo que no rompe pero es frágil o incorrecto

---

### FASE 1 — Configuración de electron-builder (`package.json` → `build`)

**Archivos a leer:**

- `package.json` (sección `build`)

**Checks:**

1.1. **`publish` configurado correctamente**

- Debe tener `provider: github`, `owner: alphagiolabs`, `repo: beru`
- `releaseType: release` (no `prerelease`)

  1.2. **`win.verifyUpdateCodeSignature: false` presente**

- Si NO está → electron-updater verificará firma del installer descargado
- Con builds sin firmar → `ERR_UPDATER_INVALID_SIGNATURE` → TODO download falla
- Este es el bug #1 que ya se aplicó fix. Verificar que sigue presente.

  1.3. **`win.signtoolOptions.publisherName` AUSENTE**

- Si ESTÁ presente → se hornea en `app-update.yml` → activa verificación obligatoria
- `publisherName` en `app-update.yml` NO es solo display — gates la verificación
- Verificar que fue removido correctamente

  1.4. **`win.target` = NSIS x64**

- Debe ser `nsis` con `arch: ["x64"]`

  1.5. **`nsis.oneClick: false`**

- Beru usa installer con wizard (no oneClick)
- `quitAndInstall()` debe usar `isSilent=false` para que el wizard sea visible
- Si `oneClick: true` + `quitAndInstall(false, true)` → el installer no puede correr en modo silent → bucle de actualización

  1.6. **`directories.output`** apunta a `dist-installer` (no `dist` o `release`)

  1.7. **`files` incluye `node_modules/electron-updater/**/\*`\*\*

- Si no está, el módulo no se empaqueta y `require('electron-updater')` falla en producción

  1.8. **`extraResources`** incluye Python processor, ffmpeg, presets

- No bloquea el updater pero verifica que no haya paths rotos

---

### FASE 2 — Workflow de GitHub Actions (`.github/workflows/`)

**Archivos a leer:**

- `.github/workflows/ci-release.yml` (o cualquier `.yml` en `.github/workflows/`)

**Checks:**

2.1. **Trigger de release correcto**

- Debe disparar en `push: tags: ["v*"]` y/o `workflow_dispatch`
- NO debe publicar en cada push a `main` (solo en tags)

  2.2. **Job de release tiene `needs: test`**

- Tests deben pasar antes de construir

  2.3. **Runs-on `windows-latest`**

- El build de Windows debe ejecutarse en Windows

  2.4. **`GH_TOKEN` / `GITHUB_TOKEN` configurado**

- Debe tener `permissions: contents: write`
- Debe pasar `GITHUB_TOKEN` como `GH_TOKEN` al step de electron-builder

  2.5. **Comando de publish correcto**

- Debe ser `npx electron-builder --publish always` (o `--win --publish always`)
- `--publish always` sube artifacts + `latest.yml` al GitHub Release

  2.6. **Code signing opcional manejado correctamente**

- Si `WINDOWS_CERTIFICATE_BASE64` no está → build sin firma (debe funcionar con `verifyUpdateCodeSignature: false`)
- Si ESTÁ → debe setear `CSC_LINK` y `CSC_KEY_PASSWORD`
- Verificar que `CSC_IDENTITY_AUTO_DISCOVERY = false` está set (evita crash en CI Linux)

  2.7. **`latest.yml` aparece en artifacts subidos**

- El workflow debe subir o publicar `latest.yml` junto al `.exe` y `.exe.blockmap`
- Sin `latest.yml` → electron-updater no puede saber qué versión hay

  2.8. **Build del renderer (Vite) con secrets de Supabase**

- `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` deben pasarse como env
- Si faltan → la app compila sin auth (graceful fallback, pero no es lo intended)

---

### FASE 3 — Código del updater en main process

**Archivos a leer:**

- `main/updater.js`
- `main/handlers/updater.js`
- `main/utils/window.js` (donde se llama `updater.init()`)
- `main/main.js`
- `main/preload.cjs`
- `main/shared-state.js`

**Checks:**

3.1. **`init()` se llama después de `did-finish-load`**

- Si se llama antes → `webContents.send` puede fallar silenciosamente
- Verificar en `window.js`: `win.webContents.once("did-finish-load", () => { updater.init(win); })`

  3.2. **Dev-mode guard funciona**

- `isDev = !app.isPackaged` → si dev, `send({ type: "disabled" })` y return
- No debe intentar `checkForUpdates()` en dev

  3.3. **`autoDownload = false`**

- Beru usa download manual (usuario debe clickear "Descargar")
- Si `true` → descarga automática que puede confundir al usuario

  3.4. **`autoInstallOnAppQuit` manejado correctamente**

- Debe empezar en `false`
- Debe pasar a `true` solo después de `update-downloaded`
- Si queda `true` siempre → instala sin consentimiento

  3.5. **Logger NO es `null`**

- `au.logger = null` causa `TypeError` en `NsisUpdater._logger.info()` interno
- Debe ser un objeto con `info/warn/error/debug`
- Verificar el fix aplicado

  3.6. **Eventos de electron-updater todos manejados**

- `checking-for-update` → `send({ type: "checking" })`
- `update-available` → `send({ type: "available", version, ... })`
- `update-not-available` → NO debe wipear un update pendiente (race condition guard)
- `download-progress` → `send({ type: "downloading", percent, ... })`
- `update-downloaded` → `send({ type: "ready", version })` + `autoInstallOnAppQuit = true`
- `error` → `send({ type: "error", message })` + reset flags

  3.7. **Race condition guards presentes**

- `pendingVersion` no se wipea con `update-not-available` tardío
- `downloadBusy` lock previene descargas concurrentes durante backoff
- `checkInProgress` previene checks duplicados
- `updateDownloaded` previene re-checks que causen re-download

  3.8. **`checkForUpdates()` no re-checkea si ya hay pending**

- Si `pendingVersion` existe → re-emite `available` sin llamar al network
- Si `updateDownloaded` → retorna `already-ready`

  3.9. **`startDownload()` con retry y backoff**

- Hasta 2 reintentos con delays exponenciales
- `downloadBusy` se mantiene durante backoff (no solo `downloadInProgress`)
- Si update abortada durante backoff → retorna `aborted`

  3.10. **`install()` usa `quitAndInstall(false, true)`**

- `isSilent=false` porque NSIS `oneClick: false` requiere wizard visible
- `isForceRunAfter=true` para relanzar la app
- Safety net: timeout de 10s para resetear `quittingForUpdate` si el quit falla

  3.11. **`will-quit` / `before-quit` respetan `isQuittingForUpdate()`**

- Si el updater está cerrando la app para instalar → NO debe cancelar processing
- Verificar en `main.js`: `if (isQuittingForUpdate()) return;` en ambos handlers

  3.12. **`getMainWindow()` se lee en vivo (no capturada)**

- Si se captura el window ref en `init()` → puede apuntar a ventana destruida
- Verificar que `send()` llama `getMainWindow()` desde `shared-state.js`

---

### FASE 4 — Bridge IPC y Preload

**Archivos a leer:**

- `main/preload.cjs`
- `main/handlers/updater.js`

**Checks:**

4.1. **Canales IPC registrados**

- `updater:check` → `updater.checkForUpdates()`
- `updater:download` → `updater.startDownload(opts)`
- `updater:install` → `updater.install()`
- `updater:getSnapshot` → `updater.getSnapshot()`

  4.2. **Preload expone todos los métodos**

- `checkForUpdates()`, `downloadUpdate(opts)`, `installUpdate()`, `getUpdaterSnapshot()`
- `onUpdaterEvent(cb)` → subscribe a `updater:event` y retorna unsubscribe fn

  4.3. **`contextIsolation: true` y `nodeIntegration: false`**

- Verificar en `webPreferences` de `window.js`
- El preload debe usar `contextBridge.exposeInMainWorld`

  4.4. **`shell:openExternal` valida URL**

- Solo dominios aprobados (github.com, beru.app)
- Bloquea IPs privadas/localhost (SSRF guard)

---

### FASE 5 — Renderer (React)

**Archivos a leer:**

- `src/hooks/useUpdater.js`
- `src/stores/slices/uiSlice.js`
- `src/utils/updateState.js`
- `src/utils/updateErrors.js`
- `src/components/UpdatePrompt.jsx`
- `src/components/status-footer/UpdateModal.jsx`
- `src/components/StatusFooter.jsx`

**Checks:**

5.1. **`useUpdater` se subscribe a eventos al montar**

- Llama `api.onUpdaterEvent(callback)` en useEffect
- Limpia subscription en cleanup

  5.2. **Hydration de snapshot al inicio**

- Llama `api.getUpdaterSnapshot()` para restaurar estado tras reload/restart
- Solo hidrata si el estado actual es `idle` o `disabled`

  5.3. **Auto-check con throttle**

- Delay inicial de ~2.5s después del mount
- Throttle de 30min vía localStorage/safeStorage
- No re-checkea si ya checkeó recientemente

  5.4. **Reducer de eventos (`updateState.js`)**

- `available` no sobrescribe un estado `downloading` o `ready` (race guard)
- `not-available` no wipea un update pendiente
- `error` no wipea un update `ready` (ya descargado)
- `error` durante `downloading` → vuelve a `available` con mensaje de error

  5.5. **UI muestra todos los estados**

- `idle` → sin badge o "Buscar actualizaciones"
- `checking` → spinner
- `available` → modal con "Descargar" + changelog
- `downloading` → progress bar con %
- `ready` → modal "Reiniciar e instalar"
- `error` → mensaje de error + botón reintentar
- `disabled` → oculto (dev build)

  5.6. **`canStartDownload()` solo permite download si `status === "available"` y hay `version`**

  5.7. **Error mapping (`updateErrors.js`)**

- Mapea códigos de error a i18n keys
- Fallback a mensaje crudo si < 200 chars

---

### FASE 6 — `app-update.yml` embebido

**Archivos a leer:**

- `dist-installer/win-unpacked/resources/app-update.yml` (si existe build local)
- O extraerlo del NSIS installer: `npx 7za e Beru-Setup-*.exe -so resources/app-update.yml 2>/dev/null`

**Checks:**

6.1. **`provider: github`**
6.2. **`owner: alphagiolabs`**
6.3. **`repo: beru`**
6.4. **`publisherName` AUSENTE** — si está presente, electron-updater activa verificación de firma obligatoria
6.5. **`updaterCacheDirName`** presente (evita colisiones de cache)

---

### FASE 7 — GitHub Release live verification

**Comandos a ejecutar:**

```bash
# Verificar el último release
gh release list --repo alphagiolabs/beru --limit 5

# Verificar assets del último release
gh release view --repo alphagiolabs/beru --json tagName,assets

# Descargar y validar latest.yml
curl -sL "https://github.com/alphagiolabs/beru/releases/latest/download/latest.yml" | head -30
```

**Checks:**

7.1. **Existe al menos un release publicado**
7.2. **El release tiene 3 assets mínimos:**

- `Beru-Setup-{version}.exe`
- `Beru-Setup-{version}.exe.blockmap`
- `latest.yml`
  7.3. **`latest.yml` es accesible vía URL pública** (`/releases/latest/download/latest.yml`)
  7.4. **`latest.yml` contiene:**
- `version:` que coincide con el tag del release
- `path:` apuntando al `.exe`
- `sha512:` hash presente
- `releaseDate:` formato ISO
  7.5. **La versión en `latest.yml` es MAYOR que la versión actual de `package.json`** (si no, no hay update que detectar)

---

### FASE 8 — Tests del updater

**Comandos a ejecutar:**

```bash
cd C:\Users\HIDROAA\Desktop\beru
npx vitest run tests/updater-main.event-race.test.js tests/update-state.test.js
```

**Checks:**

8.1. **Tests de race conditions pasan** — `updater-main.event-race.test.js`
8.2. **Tests del state reducer pasan** — `update-state.test.js`
8.3. **Tests de integración** (si existen) — buscar `tests/*updater*` o `tests/*update*`

---

### FASE 9 — Matriz de escenarios edge-case

Verificar mentalmente (o con tests) estos escenarios:

| #    | Escenario                                                  | Resultado esperado                                                            |
| ---- | ---------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 9.1  | App en dev (`!app.isPackaged`)                             | Updater disabled, IPC returns `{ ok: false, reason: "dev-build" }`            |
| 9.2  | No hay conexión a internet                                 | `checkForUpdates()` → error swallowed, UI muestra idle                        |
| 9.3  | `latest.yml` 404 (no hay releases)                         | Error swallowed, UI muestra idle                                              |
| 9.4  | Versión actual = versión latest                            | `update-not-available` → UI muestra "Actualizado"                             |
| 9.5  | Update disponible, usuario no descarga                     | Estado `available` persiste, no se auto-descarga                              |
| 9.6  | Download falla, retry exitoso                              | 2 reintentos con backoff, luego success                                       |
| 9.7  | Download falla después de 3 intentos                       | `error` event, UI muestra error + reintentar                                  |
| 9.8  | Update descargado, usuario cierra app                      | `autoInstallOnAppQuit=true` → instala al cerrar                               |
| 9.9  | Update descargado, usuario clickea instalar                | `quitAndInstall(false, true)` → wizard NSIS visible                           |
| 9.10 | `quitAndInstall` falla (spawn error)                       | Safety net timeout 10s → reset `quittingForUpdate` → usuario puede reintentar |
| 9.11 | Background check mientras hay pending                      | Re-emite `available` con versión cached, no llama network                     |
| 9.12 | Background check mientras hay downloaded                   | Retorna `already-ready`, no re-descarga                                       |
| 9.13 | `update-not-available` llega después de `update-available` | No wipea `pendingVersion` (race guard)                                        |
| 9.14 | Dos `updater:download` IPC simultáneos                     | `downloadBusy` lock → segundo retorna `already-downloading`                   |
| 9.15 | Ventana destruida y recreada                               | `getMainWindow()` lee vivo → eventos no se pierden                            |

---

### FASE 10 — Comparación con referencia funcional (Antares)

**Proyecto de referencia:** `C:\Users\HIDROAA\Desktop\antares`

**Verificar que Beru tiene los mismos elementos críticos que Antares:**

| Elemento                             | Antares (referencia)      | Beru debe tener                 |
| ------------------------------------ | ------------------------- | ------------------------------- |
| `verifyUpdateCodeSignature: false`   | ✅ `electron-builder.yml` | ✅ `package.json` build.win     |
| `publisherName` ausente o sin efecto | ✅ No lo tiene            | ✅ Removido                     |
| `publish` config GitHub              | ✅ `sechgio/antares`      | ✅ `alphagiolabs/beru`          |
| `--publish always` en CI             | ✅                        | ✅                              |
| `latest.yml` en release              | ✅                        | ✅                              |
| Dev-mode guard                       | ✅ Mock handlers          | ✅ `send({ type: "disabled" })` |
| `quitAndInstall(false, true)`        | ✅                        | ✅                              |
| Logger funcional                     | ✅ (default)              | ✅ Console wrapper              |

---

### OUTPUT ESPERADO

Genera un reporte en este formato:

```
# Auditoría Auto-Updater BERU — {fecha}

## Resumen
- Total checks: N
- PASS: N ✅
- FAIL: N ❌
- WARN: N ⚠️

## Detalle por fase

### Fase 1 — electron-builder config
[1.1] ✅ PASS — publish configurado correctamente
[1.2] ❌ FAIL — verifyUpdateCodeSignature no encontrado — Fix: agregar ...
...

## Fallos críticos encontrados
1. [descripción del fallo + impacto + fix propuesto]

## Recomendaciones no bloqueantes
1. [recomendación]

## Veredicto
✅ El flujo de auto-update es funcional / ❌ El flujo tiene fallos críticos
```
