# Testing Guide - Beru

## Prerequisites

1. **FFmpeg binary** (mandatory)
   - Download from https://github.com/BtbN/FFmpeg-Builds/releases
   - Get `ffmpeg-master-latest-win64-gpl.zip`
   - Extract `ffmpeg.exe` → put it in `src-tauri/bin/ffmpeg.exe`

2. (Optional but recommended) `ffprobe.exe` in the same folder for accurate duration.

## How to run

```bash
npm run tauri dev
```

## Basic Test Flow

1. Open a video with a visible logo/watermark
2. Draw a rectangle over the logo
3. (Optional) Set Start/End time
4. Choose:
   - **Blur** → soft removal
   - **Crop** → hard cut
   - **Text** → cover with text + background box
5. Add multiple operations if needed
6. Click **Export video**
7. Watch real progress + ETA (in console for now)

## Current Limitations (as of May 2026)

- Image overlay not fully wired yet (UI placeholder exists)
- ffprobe sidecar not bundled by default
- Text now has background box + time range
- Image overlay has model + filter support but no UI picker yet
- ETA calculation is experimental (based on speed=)

## Common Errors & Fixes

| Error | Fix |
|-------|-----|
| "ffmpeg sidecar not found" | Put `ffmpeg.exe` in `src-tauri/bin/` |
| Video doesn't play | Make sure you used the "Open video" button (not drag & drop) |
| Black output or crash | Check that the region is inside the video bounds |
| Slow processing | Normal on long/high-res videos. ETA is approximate |

## Next Manual Tests

- Multiple blurs on same video
- Time-ranged operation (e.g. only 10s-30s)
- Text with time range
- Cancel during long export

## Reporting Issues

Open an issue or tell me exactly what broke + console output.
