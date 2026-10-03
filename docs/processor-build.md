# Build del procesador de Windows

El build utiliza Python 3.14.8 x64, definido en [`.python-version`](../.python-version), tanto localmente como en CI. El Python global y sus paquetes no se modifican.

[`python/requirements-build.txt`](../python/requirements-build.txt) fija las ocho dependencias del empaquetado mediante wheels oficiales de PyPI y hashes SHA-256. NumPy utiliza 2.4.6, sujeto a [`python/requirements.txt`](../python/requirements.txt). PyInstaller utiliza 6.22.3 para incorporar la corrección de [GHSA-9fxf-4qw3-ghmr](https://github.com/pyinstaller/pyinstaller/security/advisories/GHSA-9fxf-4qw3-ghmr) y las correcciones posteriores del arranque `onefile` en Windows, documentadas en su [changelog oficial](https://pyinstaller.org/en/stable/CHANGES.html).

## Compilar

```powershell
npm run build:processor
```

El script selecciona Python 3.14.8 x64 desde `.runtime/python-3.14.8/python.exe`, `py -3.14`, `python` o `python3`. También acepta `BERU_PYTHON` como ruta al intérprete, siempre que coincida con esa versión y arquitectura.

La primera ejecución crea `.venv-processor/` y descarga las dependencias verificando sus hashes. Las siguientes comprueban sus versiones y `pip check`. Los paquetes ajenos al lock y un intérprete distinto provocan un error con instrucciones para recrear el entorno, en lugar de modificar la instalación global. La instalación emplea el [modo de hashes de pip](https://pip.pypa.io/en/stable/topics/secure-installs/) y admite únicamente wheels.

El spec incluye NumPy y los módulos temporales. Antes de copiar el ejecutable a `bin/beru-processor.exe`, el build inspecciona su archivo interno y comprueba el runtime de Python, NumPy, su extensión nativa y los módulos `temporal_motion` y `temporal_pipeline`.

## Reutilización del ejecutable

`python/build/processor-build.json` registra las versiones observadas, una huella del contenido de los archivos de entrada y el SHA-256 del ejecutable. El build solo reutiliza el binario si coinciden esas comprobaciones. Un ejecutable antiguo sin registro, una modificación de código aunque conserve su fecha o una sustitución del binario fuerzan la recompilación.

El registro se mantiene fuera del renderer compilado, no se distribuye en el instalador y no se borra al compilar con Vite. El entorno virtual, el registro y los binarios generados están excluidos de Git.

Para forzar una recompilación:

```powershell
$env:BERU_FORCE_PROCESSOR_BUILD = '1'
npm run build:processor
Remove-Item Env:BERU_FORCE_PROCESSOR_BUILD
```

## Verificaciones al cambiar el toolchain

Ejecutar lint, formato, la suite JS, la suite Python con el intérprete fijado, el build del procesador y el build local del instalador. Para probar las dependencias del build, crear un entorno virtual limpio e instalar el lock con `--require-hashes --only-binary=:all:`.

Para verificar los tests Python con el mismo intérprete y los mismos binarios que utiliza el empaquetado, ejecutar desde la raíz del repositorio en una sesión PowerShell dedicada:

```powershell
$taskRoot = (Get-Location).Path
$env:PATH = (Join-Path $taskRoot '.venv-processor/Scripts') + ';' + $env:PATH
$env:BERU_FFMPEG = Join-Path $taskRoot 'bin/ffmpeg.exe'
$env:BERU_FFPROBE = Join-Path $taskRoot 'bin/ffprobe.exe'
npm run test:python
```

Probar el ejecutable empaquetado con Python ausente de `PATH`: exportación temporal e inpaint, copia, desenfoque, recorte, trim, marca de agua, previews, errores y recuperación del worker, cancelación, rutas con espacios y acentos y limpieza de temporales. Confirmar con ffprobe que dimensiones y duración se mantienen según cada operación. Esto comprueba el binario en el equipo de desarrollo; una validación del instalador en una máquina limpia sigue siendo necesaria antes de publicar.

Si la carpeta temporal de Windows produce errores de permisos, repetir las comprobaciones con `TEMP` y `TMP` apuntando a una carpeta propia del proyecto solo durante esa ejecución. Registrar la limitación; no modificar la configuración global del equipo.
