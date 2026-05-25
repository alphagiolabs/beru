# FFmpeg Binaries (Sidecar) — OPTIMIZED FOR SMALL APP SIZE

**Current status**: Only ONE ffmpeg.exe is committed (the duplicate 195MB copy was removed).

The full BtbN build is ~195 MB. This makes the final installer much heavier than necessary.

## Recommended: Use a slim FFmpeg (25-45 MB instead of 195 MB)

For Beru we only need these filters/codecs:
- crop, boxblur, overlay, drawtext, split, scale
- libx264 (encoding) + aac copy

### How to build a minimal static FFmpeg (Windows)

1. Install MSYS2 + mingw-w64
2. Or easier: use https://github.com/BtbN/FFmpeg-Builds (but choose a custom configure later)
3. Minimal configure example (greatly reduces size):

```bash
./configure \
  --enable-gpl \
  --enable-static \
  --disable-shared \
  --disable-programs \
  --enable-ffmpeg \
  --disable-ffplay \
  --disable-ffprobe \
  --disable-doc \
  --disable-htmlpages \
  --disable-manpages \
  --disable-podpages \
  --disable-txtpages \
  --disable-debug \
  --disable-avdevice \
  --disable-swresample \
  --disable-postproc \
  --disable-avfilter \
  --enable-avfilter \
  --enable-filter=crop,boxblur,overlay,drawtext,split,scale \
  --enable-encoder=libx264 \
  --enable-decoder=h264 \
  --enable-protocol=file,pipe \
  --enable-demuxer=mov,matroska,avi \
  --enable-muxer=mp4 \
  --enable-libx264
make -j$(nproc)
strip ffmpeg.exe
```

This typically produces a **30-45 MB** `ffmpeg.exe` that still supports everything Beru needs.

## How to use (development)

1. Put a (slim or full) `ffmpeg.exe` in `src-tauri/bin/ffmpeg.exe`
2. `npm run tauri dev`

The sidecar is declared in `tauri.conf.json` under `externalBin`.

## Important for distribution

- Never commit multiple copies of ffmpeg.
- The release profile in Cargo.toml already uses `opt-level=z`, LTO, strip, etc. to keep the Rust side small.
- The final app size is dominated by the FFmpeg binary — slim it for best results.

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

---

## Aggressive Automation (Nivel Agresivo)

Beru now includes powerful tooling to keep the final app as light as possible:

### 1. One-command FFmpeg download (with slim support)

```bash
# Normal (full build)
npm run ffmpeg:download

# Force replace
npm run ffmpeg:download:force

# Use a custom slim build (the real aggressive win)
$env:FFMPEG_DOWNLOAD_URL = "https://your-slim-ffmpeg-url.zip"
npm run ffmpeg:download:force
```

### 2. Recommended build commands

```bash
npm run tauri:dev          # auto-downloads ffmpeg if missing + runs
npm run tauri:build        # aggressively prepares smallest possible ffmpeg + builds
npm run build:report       # shows size of the Rust binary after build
```

### 3. Official releases (smallest possible)

Use GitHub Actions:

1. Go to **Actions → "Release - Small & Optimized"**
2. Click **Run workflow**
3. In `ffmpeg_url` paste the direct link to your slim FFmpeg zip (30-50MB recommended)
4. The workflow will produce optimized installers and attach them to a draft release.

**New aggressive option (2026):** You can now tell the workflow to compile the minimal FFmpeg **from source** directly in CI:

- Check the box `compile_minimal` when running the workflow.
- It will use `msys2/setup-msys2` and run the full minimal compilation with `--clean`.
- **Warning**: This takes 1.5–3+ hours on GitHub's free runners (very slow). Use only for special releases where you want the absolute smallest possible binary without hosting your own slim build.

This is how you ship a truly lightweight Beru to users.

### 4. Compile your own minimal FFmpeg from source (MOST AGGRESSIVE)

This is the ultimate size reduction: **compile FFmpeg yourself** with only what Beru needs.

Requirements:
- MSYS2 installed (https://www.msys2.org/)
- 8-10 GB free disk
- 30-120 minutes the first time (much faster afterwards)

#### One command:

```bash
npm run ffmpeg:build:minimal
```

This will:
1. Detect your MSYS2 installation
2. Install all required build tools automatically
3. Download and compile a custom minimal FFmpeg
4. Copy the result (~30-60 MB) to `src-tauri/bin/ffmpeg.exe`

**Clean previous cache** (recommended before important releases):

```bash
npm run ffmpeg:build:minimal:clean
```

You can run it again anytime to get the latest FFmpeg with the same small size. The `--clean` flag deletes the build cache (`$HOME/beru-ffmpeg-build`).

#### Alternative (if you want to run it directly):

Open "MSYS2 MinGW 64-bit" from Start Menu and run:

```bash
cd /c/Users/YourName/Desktop/Beru
./scripts/build-ffmpeg-minimal.sh /c/Users/YourName/Desktop/Beru/src-tauri/bin
```

### 5. What makes the app small

- `scripts/build-ffmpeg-minimal.ps1` + `.sh` — full source compilation with minimal configure (new!)
- `scripts/download-ffmpeg.ps1` — supports any custom build via env var
- Aggressive `[profile.release]` in Cargo.toml (opt-level=z, LTO, strip, panic=abort)
- GitHub workflow that can consume slim FFmpeg on demand
- Only one ffmpeg.exe is ever used (duplicates are rejected)

Keep using this system and Beru final installers can stay under ~80-100 MB instead of 220+ MB.

