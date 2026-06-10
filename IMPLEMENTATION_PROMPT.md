# Prompt Ideal para Iniciar Implementaciones de Fixes

Este prompt está optimizado para que el agente de IA entienda el contexto completo, corrija los bugs sin romper la funcionalidad existente, y mantenga los 180 tests pasando.

---

## Prompt

```
Eres un ingeniero senior trabajando en Beru, un editor de video masivo con overlays de texto en Electron + React 19 + Zustand + Python (FFmpeg).

CONTEXTO:
- Lee C:\Users\HIDROAA\Desktop\beru\AGENTS.md para convenciones del proyecto
- Ejecuta `npm test` antes de cualquier cambio (debe pasar 180/180)
- Ejecuta `npm test` después de cada fix para verificar que no rompa nada
- Sigue el estilo Prettier configurado (semicolons, double quotes, trailing commas, 100-char print width)
- NO modifiques funcionalidad existente, solo corrige los bugs listados

REFERENCIA:
- Todos los bugs están documentados en C:\Users\HIDROAA\Desktop\beru\CODE_REVIEW_SUMMARY.md

TAREAS (en este orden, una por una):

### PRIORIDAD 1 — Bugs Críticos

**1. Race Condition en Processing State**
   - Archivo: main/shared-state.js
   - Elimina la línea `if (!_isProcessing) _processingRunId = null;` dentro de `setIsProcessing`
   - Verifica con test: npm test

**2. Memory Leak en Video Cache**
   - Archivo: main/utils/video-cache.js, función `trimVideoInfoCache`
   - Reemplaza el loop actual por una iteración correcta del Map iterator:
     ```javascript
     const iterator = videoInfoCache.keys();
     for (let i = 0; i < excess; i++) {
       videoInfoCache.delete(iterator.next().value);
     }
     ```
   - Verifica con test: npm test

**3. Fuga de Memoria en Listeners**
   - Archivo: main/handlers/process.js
   - Asegura que en el handler `process:start`, después de que el proceso Python termine (tanto en close como en error), se llame:
     ```javascript
     proc.stdout?.removeAllListeners();
     proc.stderr?.removeAllListeners();
     ```
   - Asegúrate de que los nombres de las funciones listener (onStdoutData, onStderrData) se usen en removeAllListeners también
   - Verifica con test: npm test

**4. Validación de Dimensiones de Video**
   - Archivo: python/processor.py, dentro de `_process_one` (antes de `build_filter_complex`)
   - Después de obtener `vw` y `vh`, si ambos son <= 0, emitir un error específico antes de llamar a FFmpeg:
     ```python
     if vw <= 0 or vh <= 0:
         return _job_failed_result(job_id,
             f"Dimensiones de video inválidas: {vw}x{vh}. El video puede estar corrupto o ser ilegible.",
             max_workers=_BATCH_ACTIVE_WORKERS)
     ```
   - Verifica con test: npm test

### PRIORIDAD 2 — Bugs Moderados

**5. Timeout en Operaciones de Excel**
   - Archivo: src/stores/slices/batchSlice.js, función `importExcel`
   - Envuelve el parsing de XLSX en un `Promise.race` con un timeout de 15 segundos:
     ```javascript
     const parsePromise = new Promise((resolve) => {
       const wb = XLSX.read(base64Data, { type: "base64" });
       resolve(wb);
     });
     const wb = await Promise.race([
       parsePromise,
       new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout: Excel demasiado grande")), 15000)),
     ]);
     ```
   - Verifica con test: npm test

**6. Race Condition en Drag & Drop**
   - Archivo: src/App.jsx
   - Agrega un ref `isDroppingRef = useRef(false)` y en `onDrop`:
     - Al inicio: `if (isDroppingRef.current) return; isDroppingRef.current = true;`
     - En finally del procesamiento: `isDroppingRef.current = false;`
   - Verifica con test: npm test

**7. Limpieza de Temporales de Preview**
   - Archivo: main/utils/preview-frame.js
   - Agrega un `finally` block que elimine el archivo temporal independientemente del resultado:
     ```javascript
     } finally {
       try { fs.unlinkSync(tmpFile); } catch {}
     }
     ```
   - Verifica con test: npm test

**8. Validación de JSON en Project Load**
   - Archivo: main/handlers/project.js, handler `project:load` y `project:loadFromPath`
   - Después de `JSON.parse`, valida que el dato tenga al menos la estructura básica:
     ```javascript
     if (!data || typeof data !== "object" || !Array.isArray(data) && !data.queue) {
       return { success: false, error: "Archivo de proyecto con formato inválido" };
     }
     ```
   - Verifica con test: npm test

### VALIDACIÓN FINAL
```bash
npm test
npm run lint
npm run lint:fix
```

### CRITERIOS DE ÉXITO
- Los 180 tests siguen pasando
- ESLint no reporta errores nuevos
- Ningún archivo fuera de la lista fue modificado
- El comportamiento observable de la app no cambió

### ARCHIVOS A MODIFICAR:
- main/shared-state.js
- main/utils/video-cache.js
- main/handlers/process.js
- python/processor.py
- src/stores/slices/batchSlice.js
- src/App.jsx
- main/utils/preview-frame.js
- main/handlers/project.js
```

---

## Notas sobre este Prompt

1. **Orden determinista**: Los fixes van de mayor a menor prioridad, y cada uno es independiente del siguiente.
2. **Verificación incremental**: `npm test` después de cada fix para detectar regresiones inmediatamente.
3. **Scope mínimo**: Cada fix toca solo el archivo y la función necesarios, sin refactors colaterales.
4. **No invasivo**: Ningún fix cambia la API pública, el schema de datos, o el comportamiento observable.
5. **Test-friendly**: Todos los fixes son verificables por los tests existentes sin necesidad de agregar tests nuevos.
