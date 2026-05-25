# scripts/download-ffmpeg.ps1
# Aggressive FFmpeg sidecar downloader for Beru
# Goal: Make the final distributable as small as possible without losing functionality.

param(
    [string]$Url,
    [switch]$Force
)

$ErrorActionPreference = "Stop"

$BinDir = Join-Path $PSScriptRoot "..\src-tauri\bin"
$Target = Join-Path $BinDir "ffmpeg.exe"

Write-Host "=== Beru Aggressive FFmpeg Downloader ===" -ForegroundColor Cyan

# Allow overriding with environment variable for truly slim builds (recommended for releases)
if (-not $Url) {
    $Url = $env:FFMPEG_DOWNLOAD_URL
}

if (-not $Url) {
    # Default: latest full GPL from BtbN (reliable, ~195MB)
    # For aggressive slim builds, set FFMPEG_DOWNLOAD_URL to a custom minimal build.
    $Url = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip"
    Write-Host "Using default (full) build from BtbN" -ForegroundColor Yellow
    Write-Host "For smaller final app size, set FFMPEG_DOWNLOAD_URL to a slim build (~30-50MB recommended)" -ForegroundColor DarkYellow
} else {
    Write-Host "Using custom URL (aggressive slim mode): $Url" -ForegroundColor Green
}

if ((Test-Path $Target) -and -not $Force) {
    $sizeMB = [math]::Round((Get-Item $Target).Length / 1MB, 1)
    Write-Host "ffmpeg.exe already exists ($sizeMB MB). Use -Force to replace." -ForegroundColor Green
    exit 0
}

$tempDir = New-Item -ItemType Directory -Path ([System.IO.Path]::GetTempPath() + "beru-ffmpeg-" + [guid]::NewGuid()) -Force
$zipPath = Join-Path $tempDir "ffmpeg.zip"

Write-Host "Downloading FFmpeg..." -ForegroundColor Cyan
try {
    Invoke-WebRequest -Uri $Url -OutFile $zipPath -UseBasicParsing
} catch {
    Write-Error "Failed to download: $_"
    exit 1
}

Write-Host "Extracting..." -ForegroundColor Cyan
Expand-Archive -Path $zipPath -DestinationPath $tempDir -Force

# Find ffmpeg.exe inside the extracted structure (BtbN puts it in bin/)
$found = Get-ChildItem -Path $tempDir -Recurse -Filter "ffmpeg.exe" | Select-Object -First 1

if (-not $found) {
    Write-Error "Could not find ffmpeg.exe inside the downloaded archive."
    exit 1
}

New-Item -ItemType Directory -Path $BinDir -Force | Out-Null

Copy-Item $found.FullName $Target -Force

$finalSize = [math]::Round((Get-Item $Target).Length / 1MB, 1)
Write-Host "SUCCESS! ffmpeg.exe installed at: $Target" -ForegroundColor Green
Write-Host "Final size: $finalSize MB" -ForegroundColor $(if ($finalSize -lt 80) { "Green" } else { "Yellow" })

if ($finalSize -gt 100) {
    Write-Host ""
    Write-Host "WARNING: This is still a large build." -ForegroundColor Red
    Write-Host "For the smallest possible Beru installer, replace it with a custom slim build (30-50MB)." -ForegroundColor Red
    Write-Host "See src-tauri/bin/README.md for minimal configure instructions." -ForegroundColor DarkYellow
}

# Cleanup
Remove-Item $tempDir -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "Done. You can now run: npm run tauri dev" -ForegroundColor Cyan
