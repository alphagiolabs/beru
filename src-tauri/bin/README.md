# FFmpeg Binaries (Sidecar)

**Status**: MVP de "remove logo" (blur/crop región) ya implementado.

## Cómo obtener el binario (Windows)

1. Ve a: https://github.com/BtbN/FFmpeg-Builds/releases
2. Descarga `ffmpeg-master-latest-win64-gpl.zip`
3. Extrae y copia `ffmpeg.exe` (de la carpeta `bin/`) a:
   `src-tauri/bin/ffmpeg.exe`
4. (No renombres el archivo)

Ya está declarado en `tauri.conf.json` como externalBin.

## Ejecutar en desarrollo

```bash
npm run tauri dev
```

El comando `remove_logo` usará el sidecar automáticamente.

## Notas técnicas (actuales)
- Blur: usa `split + crop + boxblur + overlay` (igual que online-video-cutter)
- Crop: usa `-vf crop=...`
- Progreso: parsea `time=` de stderr y emite evento `ffmpeg-progress`
- Solo primera operación aplicada por ahora (MVP)

## Próximos pasos recomendados
- Mejorar precisión del overlay de región (manejar escalado + video rotation)
- Soportar múltiples operaciones encadenadas
- Añadir duración real del vídeo para barra de progreso %
- macOS / Linux sidecars

Una vez que pongas el ffmpeg.exe, la feature está lista para probar.
