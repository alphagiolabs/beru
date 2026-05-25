#!/usr/bin/env bash
# scripts/build-ffmpeg-minimal.sh
#
# Advanced minimal FFmpeg builder for Beru (runs inside MSYS2 MinGW64)
# This produces a much smaller ffmpeg.exe (~30-60MB) than the full 195MB builds.
#
# Usage (from inside MSYS2):
#   ./scripts/build-ffmpeg-minimal.sh /c/Desktop/Beru/src-tauri/bin
#
# Or normally called via the .ps1 launcher.

set -euo pipefail

TARGET_DIR="${1:-}"
CLEAN="${2:-}"

if [[ -z "$TARGET_DIR" ]]; then
    echo "Usage: $0 <target-windows-dir> [--clean]"
    echo "Example: $0 /c/Users/You/Desktop/Beru/src-tauri/bin --clean"
    exit 1
fi

if [[ "$CLEAN" == "--clean" ]]; then
    echo "==> --clean requested: removing previous build cache..."
    rm -rf "$HOME/beru-ffmpeg-build"
fi

echo "=== Beru Minimal FFmpeg Builder (MSYS2) ==="
echo "Target directory: $TARGET_DIR"

# Make sure we are in a MinGW environment
if [[ "$(uname -o)" != "Msys" ]]; then
    echo "ERROR: This script must be run inside MSYS2 (preferably MinGW64 shell)."
    exit 1
fi

# Update system and install build dependencies (idempotent)
echo "==> Updating MSYS2 and installing build dependencies (this may take a while the first time)..."
pacman -Syu --noconfirm
pacman -S --needed --noconfirm \
    mingw-w64-x86_64-toolchain \
    mingw-w64-x86_64-yasm \
    mingw-w64-x86_64-nasm \
    mingw-w64-x86_64-pkgconf \
    git \
    make \
    diffutils

export PATH="/mingw64/bin:$PATH"

# Work directory (persistent cache for faster rebuilds)
BUILD_DIR="$HOME/beru-ffmpeg-build"
mkdir -p "$BUILD_DIR"
cd "$BUILD_DIR"

FFMPEG_DIR="ffmpeg"

if [[ ! -d "$FFMPEG_DIR" ]]; then
    echo "==> Cloning FFmpeg (this is done only once)..."
    git clone --depth 1 https://github.com/FFmpeg/FFmpeg.git "$FFMPEG_DIR"
else
    echo "==> Updating existing FFmpeg source..."
    cd "$FFMPEG_DIR"
    git fetch --depth 1 origin master
    git reset --hard origin/master
    cd ..
fi

cd "$FFMPEG_DIR"

echo "==> Configuring minimal FFmpeg for Beru (watermark removal + text + reencode)..."

# This configure is carefully tuned:
# - Only the filters Beru actually uses
# - Only libx264 for output
# - Small binary size
./configure \
    --enable-gpl \
    --enable-version3 \
    --enable-static \
    --disable-shared \
    --enable-small \
    --disable-debug \
    --disable-doc \
    --disable-htmlpages \
    --disable-manpages \
    --disable-podpages \
    --disable-txtpages \
    --disable-ffplay \
    --disable-ffprobe \
    --enable-ffmpeg \
    --enable-libx264 \
    --enable-encoder=libx264 \
    --enable-decoder=h264 \
    --enable-demuxer=mov,matroska,avi,flv,webm \
    --enable-muxer=mp4 \
    --enable-protocol=file,pipe \
    --enable-filter=crop,boxblur,overlay,drawtext,split,scale,format \
    --enable-parser=h264 \
    --disable-avdevice \
    --disable-postproc \
    --disable-swresample \
    --disable-programs \
    --enable-ffmpeg

echo "==> Building (this can take 30-90 minutes depending on your CPU)..."
make -j"$(nproc)"

echo "==> Stripping binary for extra size reduction..."
strip ffmpeg.exe

FINAL_SIZE=$(stat -c%s ffmpeg.exe 2>/dev/null || wc -c < ffmpeg.exe)
FINAL_SIZE_MB=$(( FINAL_SIZE / 1024 / 1024 ))
echo "==> Build finished. Size: ${FINAL_SIZE_MB} MB"

# Copy to Windows target
mkdir -p "$TARGET_DIR"
cp -f ffmpeg.exe "$TARGET_DIR/ffmpeg.exe"

echo ""
echo "✅ SUCCESS! Minimal ffmpeg.exe copied to:"
echo "   $TARGET_DIR/ffmpeg.exe"
echo ""
echo "You can now run: npm run tauri:build"
echo ""
echo "Tip: To rebuild later with latest FFmpeg, just run this script again."
echo "     It will reuse the source and be much faster on subsequent runs."
