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

## Credits
Technical approach inspired by the excellent analysis of https://online-video-cutter.com/remove-logo
