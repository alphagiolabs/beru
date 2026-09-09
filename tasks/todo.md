# Restos de simplificación — checklist

## No implementar

- [ ] StatusFooter: conservar `queueLength` en el selector (test de longitud de cola)
- [ ] Conservar `getIsProcessing` como flag del lock
- [ ] No inlinear wrappers de `processor.py`
- [ ] No unificar números de pickers de posición
- [ ] No añadir `get` / `queue` / `screen` / `videoRef` a deps de efectos existentes
- [ ] Conservar `createWatermarkSlice(set, get)`

## Fase 1

- [x] Task 1: letterbox compartido en `video-utils.js`
- [x] Task 2: `hasVideoDimensions` en `shared/has-video-dimensions.js`
- [x] Task 3: Header capacidad vía selector derivado (sin `get` en deps)
- [x] Task 4: quitar fallback `getCellTextForRegion` en `resolvePreviewText`
- [x] Checkpoint: lint, format:check, npm test

## Fase 2

- [x] Task 5: tests async; borrar spawn/input sync
- [x] Task 6: presets desde disco; localStorage one-shot
- [x] Checkpoint: lint, format:check, npm test

## Fase 3

- [x] Task 7a: test que fije resize de canvas (hoy sin clamp) — `applyResizeRaw`
- [ ] Task 7b: unificar con clamp en canvas solo con OK de producto (el canvas ya usa `applyResizeRaw` + `applyMove`)

## Fase 4 opcional

- [ ] Task 8: decidir si `shadcn` CLI se queda en devDependencies

## Fase 5 — deuda conocida (auditoría 2026)

- [x] Task 9: lógica de workers duplicada y divergente — `main/workerPolicy.js` vs `python/processor.py`. Resuelto: el hint Auto ahora usa la misma fórmula que el procesador, incluido `_memory_cap_workers` (estimador de RAM por job con per-job `videoCodec`/`pixFmt`/dimensiones desde la cola). Residuo conocido y aceptado: (a) la lectura de RAM difiere (`os.freemem` vs `psutil.available`), y (b) Python resuelve el perfil de batch por el conjunto de jobs (uquality > quality > balanced > fast) mientras el hint usa el perfil de settings; el badge "Último run: N workers" del Header muestra el hecho real para detectar desviaciones.
