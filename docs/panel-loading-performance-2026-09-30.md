# Carga diferida de paneles — 2026-09-30

Seguimiento de la [auditoría de rendimiento](performance-audit-2026-09-30.md). La [evidencia JSON](panel-loading-performance-2026-09-30.json) conserva las doce mediciones de arranque, las solicitudes por panel, hashes y el diff delimitado contra los archivos guardados al empezar.

Este informe describe primero la introducción de carga diferida. La [mejora de primera apertura](#seguimiento--señal-de-carga-y-precarga-por-intención) documentada al final sustituye después el fallback vacío y añade precarga por intención; no invalida las mediciones históricas de arranque.

El arranque vacío solicita cuatro scripts locales frente a los catorce anteriores. El JavaScript solicitado baja de 1.072.877 a 931.011 bytes: 141.866 bytes menos, aproximadamente un 13,2 %. Los paneles siguen disponibles y pagan su importación en el primer uso. Estas muestras no demuestran una reducción estable del tiempo total de arranque.

## Causa y cambio

Los modales ya se declaraban con `React.lazy`, pero `App` y `BeruRoot` los montaban incondicionalmente. Sus módulos se importaban antes de que pudieran comprobar el flag de apertura y devolver `null`. Settings también importaba directamente las dos pestañas de apariencia y usuarios; apariencia importaba el editor de temas aunque no se estuviera editando uno.

Además, `LogoSidePanel` arranca en la pestaña de archivos cuando la cola está vacía, pero importaba el inspector y la lista de capas de la pestaña de herramientas cerrada. Los mismos componentes se importaban desde `App` para el modo de texto en lote, lo que mantenía esa dependencia en el chunk inicial.

Se aplicó lo siguiente:

- [DeferredPanel](../src/components/DeferredPanel.jsx) no monta el hijo hasta que su selector del store se activa. Después del primer montaje confirmado conserva el componente, dejando que este controle su visibilidad. Así sobreviven los estados locales que antes sobrevivían al cierre.
- Se difieren atajos, tabla, mapeo Excel, marca de agua, ajustes y paleta de mascotas. El módulo de la mascota se solicita si está habilitada **o** si tiene una ventana separada; su escucha de eventos y sincronización siguen funcionando en ese segundo caso. El teclado global de mascotas permanece activo.
- Ajustes importa solo la pestaña que muestra. Apariencia importa el editor de temas al entrar en edición. Se conservan los permisos existentes para la pestaña de usuarios y el comportamiento anterior de montaje al cambiar de pestaña.
- [editor-panels](../src/components/editor-panels.js) comparte las declaraciones lazy del inspector y la lista de capas entre los dos consumidores. Los límites `Suspense` están dentro de las zonas que ya se mostraban condicionalmente. Un inspector visible, incluido un proyecto restaurado, inicia su carga inmediatamente; el cambio no modifica sus reglas de visibilidad.

El cambio conserva el gate de autenticación, la resolución inicial de sesión y las cargas de configuración. No añade prefetch al arranque ni nuevos textos de interfaz. El CSS inicial mantiene el mismo archivo emitido.

## Medición

Electron 35.7.5 en Windows 11, i5-12400, doce CPU lógicas y 7,78 GiB de RAM. Se compilaron el estado inicial guardado y la versión final en directorios temporales independientes, con configuración Supabase vacía y una referencia al store añadida solo por el plugin del arnés. No se usaron la sesión ni la configuración persistente del usuario.

Se alternaron las dos versiones con tres perfiles nuevos y tres reaperturas de esos perfiles por versión. “Frío” significa un proceso y perfil de Chromium nuevos; no un reinicio de Windows ni una caché de disco vacía. La latencia va desde lanzar Electron hasta encontrar `.app-shell` y completar dos callbacks de animación con la ventana visible. Las solicitudes y métricas se tomaron dos segundos después. No se ejecutaron suites durante estas mediciones.

Los bytes corresponden a los archivos JavaScript **finales emitidos**, consultados a partir de las solicitudes reales; no a tamaños intermedios del hook de Rollup. Gzip es una equivalencia calculada, no compresión de la entrega local mediante `file:`.

| Medida                                                    |           Antes |        Después |
| --------------------------------------------------------- | --------------: | -------------: |
| Scripts solicitados en arranque vacío                     |              14 |              4 |
| JavaScript inicial                                        | 1.072.877 bytes |  931.011 bytes |
| Equivalente gzip                                          |   309.020 bytes |  271.616 bytes |
| Archivo principal emitido                                 |   700.051 bytes |  642.200 bytes |
| Arranque con perfil nuevo, mediana de tres                |          955 ms |       1.273 ms |
| Arranque con perfil nuevo, mínimo–máximo                  |    931–1.118 ms |   902–3.871 ms |
| Arranque con perfil reutilizado, mediana de tres          |          643 ms |         633 ms |
| Arranque con perfil reutilizado, mínimo–máximo            |      588–867 ms |     603–842 ms |
| Heap JS en la captura de arranque, mediana de seis        |        6,59 MiB |       5,95 MiB |
| Working set agregado de Electron, mediana de seis         |       399,7 MiB |      397,1 MiB |
| CPU acumulada de procesos Electron en la captura, mediana |  1,924 s de CPU | 1,772 s de CPU |
| Tiempo ocupado del renderer hasta la captura, mediana     |          257 ms |         256 ms |

En todas las pasadas finales, los scripts iniciales fueron el principal, el chunk compartido de entrada, iconos y vendor. Los módulos de los paneles cerrados no figuraron en las solicitudes iniciales. Supabase, React y el resto de la entrada necesaria permanecen en ese grafo; no se atribuye al cambio una reducción del total de código instalado.

La pasada final de 3.871 ms empezó con 481 MiB de RAM libre, frente a 1.138 MiB en su referencia intercalada. Se conserva como medición válida: la ventana permaneció visible y no hubo errores de consola. Esa presión de memoria y la variación entre procesos impiden atribuirle una causa aislada. La mediana fría empeora y la caliente apenas cambia; no se anuncia una mejora estable de latencia, CPU total ni memoria física.

## Primer uso y preservación de comportamiento

Se verificaron quince acciones en Electron real: los cuatro modales del editor, herramientas de logo, inspector en lote, apariencia, editor de temas, vuelta a apariencia, usuarios, galería de mascotas, paleta, reapertura de paleta, reapertura de ajustes y evento de cierre de la ventana de mascota. Todas encontraron el contenido esperado, sin errores de consola ni de carga de chunks.

Las primeras aperturas finales tardaron aproximadamente 332–437 ms, incluyendo importación, render de React, sondeo del arnés y dos callbacks de pintura. La reapertura de paleta tardó 40 ms y la de ajustes 98 ms, sin solicitudes nuevas de JavaScript. Son observaciones de un escenario instrumentado, no INP ni una comparación controlada de cada interacción. La importación diferida traslada coste al primer uso.

La paleta mantuvo su búsqueda después de cerrar con Escape y reabrir. Se comprobó que una mascota inicialmente deshabilitada carga su módulo al activar el estado de ventana separada y procesa el evento IPC `petOverlay:event` de cierre. El inspector se verificó tanto desde herramientas de logo como desde texto en lote. También se revisó visualmente la captura de ajustes.

## Verificación

Las dos pruebas nuevas de [ciclo de vida](../tests/deferred-panel.test.jsx) protegen contratos distintos: no importar antes de abrir y conservar un borrador al cerrar/reabrir; cerrar durante una importación pendiente sin que la resolución vuelva a mostrar el panel ni oculte el workspace. La regresión plausible sería montar un lazy cerrado o desmontar el componente en cada cierre. Las pruebas previas de modales no ejercitaban el límite compartido. El helper tiene siete consumidores de producción; no se añadió un seam exclusivamente para tests.

Tres pruebas existentes de apariencia e inspector asumían contenido síncrono. Se adaptaron para esperar los módulos reales antes de comprobar sus controles, conservando las aserciones visibles. La prueba de usuarios comprueba ahora también el contenido del panel, además del estado de la pestaña. La primera suite completa detectó esa espera pendiente en `app-rail`; se corrigió y se repitió la suite completa.

- Pruebas focalizadas: 45 casos en once archivos; los siete casos de `app-rail` pasaron después de adaptar la espera.
- `npm test`: 145 archivos y 1.041 casos pasaron en la repetición final.
- `npm run lint` y `npm run format:check` pasaron; los resultados posteriores a la documentación quedan en el JSON.
- Build Vite y comprobación nativa de primeros usos pasaron. Se conserva el aviso sobre chunks de más de 500 kB. El sourcemap del store instrumentado no se usó para atribución por línea.
- Se revisaron el diff delimitado, hashes, enlaces del informe y `git diff --check`.

Respecto a las copias guardadas al empezar: producción añade 74 líneas y elimina 36 en siete archivos, incluidos los dos nuevos módulos. El nuevo test contiene 78 líneas; se adaptaron tres archivos de tests existentes. Estas cifras excluyen las modificaciones previas del checkout y no son un indicador de calidad. Se conservaron los cambios ajenos.

No se modificó Python ni se ejecutó su suite específica. No se probó un instalador, una sesión real con red lenta ni un arranque tras reiniciar el sistema. El acceso inicial a los chunks sigue usando el `Suspense` existente con fallback vacío. Los arneses, builds, perfiles y captura completa están en `C:/Users/HIDROAA/AppData/Local/Temp/beru-performance-audit-20260930`, con prefijos `panels-complete-*` y `build-panels-*`. Las series piloto y la variante intermedia sin inspector diferido no se mezclaron con la comparación final.

## Seguimiento — señal de carga y precarga por intención

Se implementó la recomendación sobre primeras aperturas. [PanelLoading](../src/components/PanelLoading.jsx) muestra un indicador y un mensaje traducido en español e inglés. Cada modal tiene un límite `Suspense` independiente, con cierre durante la importación; el inspector, las pestañas de ajustes y el editor de temas muestran el indicador dentro de su zona. La animación respeta `prefers-reduced-motion`. La carga de la mascota de escritorio sigue sin mostrar un modal.

[lazyPanel](../src/utils/lazy-panel.js) comparte la misma importación entre precarga y render. Hover mediante `pointerenter` o foco precargan únicamente el destino: tabla con videos disponibles, marca de agua habilitada, mapeo Excel, ajustes y su pestaña actual, herramientas/inspector, pestañas de ajustes y edición de temas. La pestaña de usuarios sigue requiriendo administrador. La paleta inicia su importación al recibir `Ctrl/Cmd+K`, mientras se prepara su catálogo. No se añaden precargas por temporizador ni durante el arranque.

La precarga no monta componentes ni inicia sus efectos. Si falla antes de abrir, la apertura puede volver a intentar la importación; los errores de una apertura real siguen llegando al límite de errores existente. Un módulo ya precargado se entrega mediante el contrato público de thenable de [`React.lazy`](https://react.dev/reference/react/lazy), sin una nueva suspensión asíncrona para un resultado disponible. `DeferredPanel` recuerda el panel solo después de que su contenido se haya montado: conserva borradores al cerrar/reabrir, pero cancelar una primera carga pendiente no monta efectos ocultos cuando termina.

### Comparación de primeras aperturas

La [evidencia de este seguimiento](panel-opening-performance-2026-09-30.json) conserva tres procesos y perfiles nuevos por variante, alternados, una pasada final sin intención y una comprobación visual. Se usó Electron 35.7.5 en la misma máquina Windows, con builds aislados, Supabase sin configurar y fixture local de usuarios/mascotas sin servicios remotos. Antes de cada clic con intención se esperaron **450 ms después del hover o foco** en ambas variantes; el tiempo de esa anticipación no está incluido en la latencia de apertura. Las mediciones van desde activar el control hasta encontrar el contenido real y completar dos callbacks de pintura. No son INP ni garantías de latencia de cada usuario.

| Primera apertura, mediana de tres |  Antes | Con intención |
| --------------------------------- | -----: | ------------: |
| Marca de agua                     | 333 ms |         36 ms |
| Ajustes / apariencia              | 356 ms |         52 ms |
| Editor de temas                   | 352 ms |         53 ms |
| Usuarios                          | 336 ms |         32 ms |
| Galería de mascotas               | 337 ms |         63 ms |
| Inspector de herramientas         | 358 ms |         50 ms |

En la pasada final **sin anticipación**, esas primeras aperturas tardaron 330–378 ms: el coste no desaparece si el usuario abre directamente. Atajos, mapeo y paleta se abrieron directamente desde el store en este arnés y no se atribuye a esos casos una mejora por intención. El inspector de lote se verificó después de herramientas, con módulos ya cargados; tampoco representa una primera apertura fría independiente. La tabla está cubierta por sus pruebas de UI y por el contrato de intención, pero no se midió su latencia nativa en esta serie.

Los ocho arranques solicitaron cuatro scripts y ningún panel cerrado. En los builds comparados el JavaScript inicial fue de 951.695 y 954.212 bytes, una diferencia de 2.517 bytes (0,26 %). La comparación incluye también un cambio concurrente ajeno en la notificación de errores de `useFfmpegPreview`; por eso esa diferencia no se atribuye exclusivamente a esta implementación. No se ejecutó el render FFmpeg durante las aperturas. No se midió de nuevo el tiempo total de arranque y no se afirma una aceleración estable.

Se excluyeron las primeras pasadas de diagnóstico, que coincidieron con otra auditoría en la misma máquina y sufrieron suspensión de callbacks de pintura al ocluirse la ventana. La serie publicada se ejecutó en una ventana coordinada sin suites ni benchmarks simultáneos y con `backgroundThrottling` desactivado en ambas variantes. Este ajuste del arnés evita bloqueos por oclusión; no cambia la configuración de producción.

### Verificación del seguimiento

La captura nativa muestra «Cargando Marca de agua…». Se retrasó artificialmente su chunk 1,4 s únicamente en esa comprobación visual: Escape cerró el indicador y el modal, la resolución no los volvió a abrir y la reapertura posterior encontró el contenido. Las pasadas de rendimiento no usan ese retraso. Ninguna de las ocho pasadas publicó errores de consola; las precargas tampoco montaron el contenido antes del clic.

- Los cuatro casos nuevos de carga, intención y recuperación, junto con los dos existentes de ciclo de vida, pasaron. La prueba de cancelación comprobó también que no se montan efectos después de cancelar una primera carga.
- `npm test` pasó después del último cambio de código: **160 archivos y 1.091 casos**. El checkout compartido incluye pruebas de otras tareas; el conteo no se atribuye a este cambio.
- ESLint y Prettier pasaron para todos los archivos tocados. El build Vite aislado pasó, conservando el aviso existente de chunks de más de 500 kB.
- `npm run lint` global falló con veinte `no-undef` en `scripts/performance/renderer.mjs`; `npm run format:check` global detectó seis archivos ajenos: `main/utils/paths.js`, `main/utils/thumbnail-disk-cache.js`, `main/utils/thumbnail.js`, `scripts/benchmark-memory.mjs`, `scripts/performance/electron.mjs` y `scripts/performance/renderer.mjs`. No se modificaron para obtener una falsa aprobación global.

El arnés, las copias iniciales, los builds, las salidas de verificación y `panel-loading.png` están en `C:/Users/HIDROAA/.capy/work/panel-intent-20260930`. Solo las series `verified-*` forman parte de la evidencia final. No se modificó Python, no se probó un instalador y no se hicieron commits, push ni PR.
