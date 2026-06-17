# Beru

Editor de video por lotes con overlays de texto desde Excel, desenfoque, recorte y eliminación de logotipos.

## Requisitos

| Componente | Desarrollo (`npm run dev`) | Instalador `.exe` |
|---|---|---|
| Node.js 18+ | Sí | No (incluido en el build) |
| Python 3.8+ | Sí (solo para desarrollo) | **No** — incluido empaquetado |
| FFmpeg / ffprobe | Auto con `npm install` | Incluidos en el instalador |

El instalador de Windows incluye **FFmpeg, ffprobe y el procesador de video** (`beru-processor.exe`). No hace falta instalar Python ni FFmpeg manualmente.

En desarrollo, Python 3 sigue siendo necesario para ejecutar `processor.py` directamente, o puede generarse el binario incluido con `npm run build:processor`.

Los videos de entrada deben estar **disponibles localmente** en disco. Archivos de OneDrive, Google Drive o Dropbox en modo "solo en la nube" no se pueden procesar hasta que se descarguen.

## Instalación

```bash
npm install
```

`npm install` descarga automáticamente FFmpeg y ffprobe en `bin/` (script `postinstall`).

Si los binarios no se copiaron, ejecute manualmente:

```bash
npm run fetch:ffmpeg
```

## Uso

```bash
npm run dev
```

## Pruebas

```bash
npm test
```

## Compilación

```bash
npm run build
```

El instalador se genera en `dist-installer/`.

## Firma de código (Windows)

Para firmar el instalador en GitHub Actions, configura los siguientes secrets:

- `WINDOWS_CERTIFICATE_BASE64`: Certificado `.p12`/`.pfx` en Base64
- `WINDOWS_CERTIFICATE_PASSWORD`: Contraseña del certificado

## Licencia

Este proyecto está bajo licencia MIT.
