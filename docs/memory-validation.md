# Validación de memoria con medios

Seguimiento de [la auditoría de rendimiento](performance-audit-2026-09-30.md). Las mediciones con clips sintéticos son controles del arnés, no sustituyen los archivos de cámara ni permiten declarar validada la política para todos los equipos.

## Matriz de procesado

En Windows, con las dependencias instaladas, Python accesible como `python` y los binarios de `bin/`:

```powershell
node scripts/benchmark-memory.mjs C:\clips\memory-matrix.json 3 5
```

El segundo argumento es el número de pasadas; el tercero, los segundos de reposo después de cada lote. `BERU_BENCH_PYTHON` permite seleccionar otro ejecutable de Python. El arnés usa el worker persistente del procesador actual, no `bin/beru-processor.exe`, y conserva el mismo proceso durante todas las pasadas. Cada ejecución crea una carpeta nueva en el directorio temporal; nunca utiliza los `output_path` del manifiesto ni sobrescribe las entradas.

El archivo de matriz tiene este formato; las rutas relativas se resuelven desde ese archivo:

```json
{
  "provenance": "real",
  "scenarios": [
    {
      "name": "4k-hevc10-audio-text",
      "jobs": [
        {
          "input_path": "camera-hevc10.mp4",
          "encode_profile": "balanced",
          "trim_start": 0,
          "trim_end": 30,
          "operations": [
            {
              "mode": "text",
              "text": "MEMORY VALIDATION",
              "font_size": 48,
              "font_family": "Arial",
              "font_color": "white",
              "region": { "x": 40, "y": 200, "w": 1000, "h": 160 }
            }
          ]
        }
      ]
    }
  ]
}
```

Usar `provenance: "synthetic"` para clips generados. Esa declaración describe el origen aportado por quien prepara la matriz; el arnés no certifica que una grabación sea real. Los metadatos de resolución, codec, formato de píxel, duración y audio se leen con ffprobe, no se confía en valores copiados de otra grabación.

Preparar escenarios independientes, con al menos dos trabajos cuando se quiera comprobar concurrencia:

| Escenario                                               | Propósito                                                                                  |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| H.264 1080p con audio, texto y varios filtros           | Referencia de resolución habitual y coste de filtros/audio.                                |
| HEVC 4K de 8 y 10 bits con audio y un texto             | Medir el decodificador sin reducir la resolución de salida.                                |
| HEVC 4K con audio, desenfoque regional, texto y recorte | Medir una cadena compuesta; registrar también las dimensiones de salida.                   |
| El mismo caso con `encode_profile: "uquality"`          | Medir software sin confundirlo con QSV ni con un fallback.                                 |
| Sin operaciones, marca de agua ni recorte               | Medir copia/remux y su pool independiente de dos tareas.                                   |
| Clips largos y distintos de cámara                      | Comprobar que los picos no dependen del patrón sintético o de reutilizar una sola entrada. |

El arnés fuerza workers automáticos y desactiva reintentos: no oculta un primer fallo detrás de una segunda pasada. Comprueba el resumen del worker, existencia y duración positiva de las salidas, video y preservación de la presencia de audio. No comprueba por sí solo sincronía A/V, integridad de todos los fotogramas ni calidad visual.

## Sesión de paneles y proyecto grande

```powershell
node scripts/performance/benchmark-panel-memory.mjs C:\clips\camera.mp4 15 500
```

Los últimos argumentos son minutos de repetición y tamaño de la cola. Se compila el renderer actual en una carpeta temporal, con Supabase deshabilitado y perfil de Electron independiente. La referencia al store solo existe en ese build instrumentado; no se modifica el renderer de producción ni el build habitual.

La sesión construye un proyecto de estrés: 500 entradas que referencian la misma fuente, diez regiones de texto por entrada y 5.000 filas de Excel con diez columnas de texto. No representa la importación de 500 archivos diferentes. Abre y cierra atajos, marca de agua, mapeo, tabla, apariencia y paleta; registra el heap antes/después de GC forzado, documentos, nodos, listeners y métricas de Electron. Al terminar vacía el proyecto y vuelve a medir con los paneles conservados.

Si faltan los recursos de mascotas o su carga produce errores de CSP, añadir `--without-palette` excluye únicamente ese panel y lo deja registrado en la configuración de evidencia. Esa pasada no valida la paleta. La tabla se omite en la reapertura del proyecto ya vacío porque su componente no muestra el editor sin entradas. El arnés confirma que los modales desaparezcan al cerrar y desactiva el throttling de fondo de esa ventana instrumentada; no usa callbacks de pintura como reloj de espera.

El GC permite comparar memoria JS retenida, pero altera la sesión: no es una prueba de latencia de interacción ni demuestra el comportamiento del recolector sin instrumentación. Ejecutar sesiones de 60–120 minutos para complementar la prueba corta y usar proyectos representativos antes de modificar la preservación de estado de los paneles. La prueba no recorre usuarios, edición de temas, todas las mascotas, video continuo ni cambio entre cientos de archivos distintos.

## Evidencia y criterios

Ambos comandos muestran la carpeta de evidencia al terminar. Conservar `report.json` o `panels.json`, `memory.jsonl`, logs, manifiestos y versión/hash del checkout junto con la procedencia de los medios. Los manifiestos y logs contienen rutas locales; revisarlos antes de compartirlos.

El muestreador [sample-memory.ps1](../scripts/performance/sample-memory.ps1) usa APIs nativas de Windows cada 200 ms y solo incluye el PID raíz y sus descendientes. Registra memoria residente, bytes privados y disponibilidad física/commit. Los procesos muy breves y los picos entre muestras pueden escapar; el working set agregado cuenta páginas compartidas varias veces y no incluye toda la memoria gráfica.

- Una ejecución fallida o sin muestras no valida el escenario. Inspeccionar `processor.log` antes de atribuir un error a falta de RAM.
- Comparar la estimación por tarea con el pico privado de un FFmpeg de codificación, identificando los probes de preflight. No comparar una estimación individual con la suma de varios procesos.
- Comparar la concurrencia admitida con la disponibilidad registrada y el encoder que realmente ejecutó el trabajo. La política permite al menos una tarea aunque no alcance el presupuesto; es control de concurrencia, no garantía de ausencia de OOM.
- En paneles, comparar puntos equivalentes con todos los modales cerrados. Un coste de primera importación que se estabiliza no demuestra una fuga; un crecimiento sostenido entre ciclos exige inspeccionar retainers en un heap snapshot.
- No ejecutar simultáneamente otros benchmarks, builds ni suites de tests. Las aplicaciones del usuario permanecen abiertas; documentar la presión de memoria y descartar las series contaminadas por mediciones de otros agentes.

El quality gate y la prueba de memoria son controles distintos: los tests no simulan un codec ni certifican consumo real. La [matriz de Definition of Done](agents/definition-of-done.md) sigue aplicando a cualquier ajuste de la política.
