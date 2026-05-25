# Beru

Desktop video editor (Tauri + Svelte 5) — 100% local, no limits.

## Current Features

### Remove Logo / Watermark (MVP done)
- Drag & drop or open any video (MP4, MOV, AVI, MKV...)
- Accurate rectangular region selector directly on the video (handles letterboxing)
- Two removal methods:
  - **Blur** — Gaussian blur on the selected area (same technique as online-video-cutter.com)
  - **Crop** — simple frame crop
- Queue and apply **multiple operations** (blur + crop + text) with optional time ranges
- Real **cancellation** support during export
- **Time range** per operation (e.g. only blur logo between 12s-45s)
- Basic **text overlay** foundation (drawtext)
- Real-time progress using FFmpeg `time=` parsing
- Exports next to original file with `_no_logo` suffix

**How to use (after setup):**
1. Put a static `ffmpeg.exe` in `src-tauri/bin/ffmpeg.exe` (see `src-tauri/bin/README.md`)
2. `npm run tauri dev`
3. Open video → draw rectangle → choose Blur or Crop → Export

## Architecture
- Frontend: Svelte 5 + Tailwind + Tauri APIs
- Backend: Rust + `tauri-plugin-shell` sidecar (bundled FFmpeg)
- All processing happens locally (privacy + no file size limits)

## Next (high priority)
- Full text styling (font, background box, animation)
- Image/logo replacement (tapar con imagen)
- macOS & Linux ffmpeg sidecars
- Rotation metadata + SAR/DAR handling in region selector
- ffprobe integration for accurate duration + thumbnail scrubber

## Development

```bash
npm install
npm run tauri dev
```

See:
- `src-tauri/bin/README.md` — FFmpeg binary setup
- `TESTING.md` — How to test the remove logo + text features

## Lightweight & Aggressive Optimization

Beru is engineered to stay as small and memory-efficient as possible:

- **FFmpeg automation**: `npm run ffmpeg:download` + full slim build support via env var
- **Compile from source**: `npm run ffmpeg:build:minimal` — builds a 30-60 MB FFmpeg automatically with MSYS2 (most aggressive)
- **Rust binary**: Aggressive release profile (`opt-level=z`, LTO, strip, panic=abort)
- **CI releases**: `.github/workflows/release.yml` lets you build official installers with a 30-50 MB custom FFmpeg
- **No bloat**: Only one FFmpeg binary, object URLs are properly revoked, minimal Tauri features

To build the smallest possible release:

```bash
# Option A - Use a prebuilt slim binary
$env:FFMPEG_DOWNLOAD_URL = "https://your-slim-ffmpeg.zip"
npm run tauri:build

# Option B - Compile your own minimal version (recommended for max reduction)
npm run ffmpeg:build:minimal

# Clean previous compilation cache first (good before final releases)
npm run ffmpeg:build:minimal:clean
```

In GitHub Actions you now also have the option to compile the minimal version directly in CI (check `compile_minimal` — very slow on free runners).

## Credits
Technical approach inspired by the excellent analysis of https://online-video-cutter.com/remove-logo
