# Desarrollo de Beru

## Estructura y entorno

Las versiones de desarrollo están en [`.node-version`](../.node-version) y
[`.python-version`](../.python-version). Los scripts y las dependencias vigentes
están en [`package.json`](../package.json).

| Ruta              | Contenido                                                         |
| ----------------- | ----------------------------------------------------------------- |
| `main/`           | Proceso principal de Electron, handlers IPC y ejecución de medios |
| `src/`            | Renderer React, componentes, stores, hooks e i18n                 |
| `python/`         | Procesador, filtros, reconstrucción y tests de Python             |
| `shared/`         | Contratos y utilidades compartidos entre main y renderer          |
| `resources/`      | Perfiles de encode, política de workers y recursos de la app      |
| `scripts/`        | Desarrollo, validación, build, empaquetado y releases             |
| `tests/`          | Tests de JavaScript y React                                       |
| `bin/`            | FFmpeg, ffprobe y procesador empaquetado, generados localmente    |
| `build/`          | Renderer compilado por Vite                                       |
| `dist-installer/` | Instalador y metadatos de actualización                           |

Consultar [README](../README.md) para instalar y ejecutar el proyecto. El
`postinstall` descarga FFmpeg y ffprobe; `npm run fetch:ffmpeg` repite esa descarga.
`npm run build:processor` genera el procesador empaquetado con sus dependencias.

`.env` está ignorado por Git. Vite incorpora las variables `VITE_*` al compilar;
CI proporciona `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`. Los videos de entrada
deben estar disponibles en disco local, incluidos los sincronizados desde la nube.

Si el lanzador de Python apunta a una instalación antigua, se puede seleccionar el
entorno del proyecto para esa sesión de PowerShell:

```powershell
$env:BERU_PYTHON = (Resolve-Path .venv-processor/Scripts/python.exe).Path
```

## Auditoría de código muerto

La ausencia de referencias estáticas es una pista, no una prueba de que un símbolo
pueda eliminarse. Antes de retirar código:

1. Revisar el estado de Git y delimitar los cambios autorizados, conservando el
   trabajo previo.
2. Buscar nombres completos y prefijos en fuentes, tests, scripts, configuración y
   recursos. Incluir archivos ocultos y scripts versionados; excluir binarios y
   salidas generadas de la evidencia de uso.
3. Comprobar consumidores indirectos y contratos. Si la evidencia no basta,
   conservar el candidato y describir la duda.
4. Aplicar cambios pequeños y ejecutar las comprobaciones correspondientes.

Falsos positivos que requieren revisión en Beru:

- Electron conecta handlers, preload, protocolos y eventos mediante strings e
  imports dinámicos.
- PyInstaller necesita `hiddenimports`; también hay consumidores Python que
  acceden a atributos dinámicamente. Revisar sus módulos propietarios y el spec.
- Las claves i18n, variantes CSS y clases Tailwind pueden construirse con prefijos
  o interpolaciones. Un selector agrupado puede contener una clase todavía viva.
- Las suscripciones Zustand y las dependencias de hooks pueden controlar renders,
  reinicios e invalidación aunque su valor no se lea localmente.
- Los parámetros posicionales, exports y dependencias pueden pertenecer a
  contratos de CLI, build, empaquetado o inicialización.
- `resetSessionWriteCache`, `invalidateBeruStatCache`, `PROCESSING_LOCK_MAX_MS` y los
  `hiddenimports` del procesador tienen consumidores intencionales. Verificar esos
  consumidores antes de proponer su eliminación.

Las convenciones están en [CODING_STANDARDS](../CODING_STANDARDS.md) y el vocabulario
del dominio en [CONTEXT](../CONTEXT.md).

## Git y releases

La base es `main`; integrar mediante PR. Conservar commits existentes y cambios
ajenos. Push, tags, publicación de contenido y releases requieren autorización
explícita; no se deducen de haber hecho un merge.

Una release parte de una PR fusionada con un commit `fix: ship vX.Y.Z` o
`feat: ship vX.Y.Z` y una entrada de esa versión en [CHANGELOG](../CHANGELOG.md).
El usuario invoca después la skill local `release-pipeline`.

El comportamiento de empaquetado está en
[`scripts/electron-builder.config.cjs`](../scripts/electron-builder.config.cjs), y
la validación, firma y publicación en
[`.github/workflows/ci-release.yml`](../.github/workflows/ci-release.yml).

## Verificación

Ejecutar desde la raíz del repositorio:

```powershell
npm run verify
```

Este gate ejecuta lint, Prettier, Vitest con cobertura y los tests de Python. Los
archivos de guías y skills ignorados por Git necesitan además una comprobación
explícita de Prettier. Revisar también los enlaces y rutas de la documentación
modificada. Los tests omitidos o las comprobaciones que no pudieron ejecutarse se
reportan por separado de las aprobadas.
