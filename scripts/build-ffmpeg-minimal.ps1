# scripts/build-ffmpeg-minimal.ps1
#
# ADVANCED: Automatically compiles a minimal FFmpeg (~30-60MB) using MSYS2.
# This is the most aggressive size optimization possible for Beru.
#
# Requirements:
# - Windows 10/11 64-bit
# - ~8-10 GB free disk space
# - Good CPU (the build takes 30-120 minutes the first time)
#
# Usage:
#   .\scripts\build-ffmpeg-minimal.ps1
#   .\scripts\build-ffmpeg-minimal.ps1 -Clean     # deletes previous build cache
#
# After it finishes, you will have a tiny ffmpeg.exe in src-tauri/bin/

param(
    [switch]$Clean
)

$ErrorActionPreference = "Stop"

Write-Host "=== Beru Advanced Minimal FFmpeg Builder ===" -ForegroundColor Cyan
Write-Host "This will compile a custom small FFmpeg from source using MSYS2." -ForegroundColor Yellow
Write-Host "First run can take 45-120 minutes. Subsequent runs are much faster." -ForegroundColor Yellow
Write-Host ""

$ProjectRoot = Split-Path $PSScriptRoot -Parent
$TargetDir   = Join-Path $ProjectRoot "src-tauri\bin"
$ShScript    = Join-Path $PSScriptRoot "build-ffmpeg-minimal.sh"

# Possible MSYS2 locations
$PossibleMsysRoots = @(
    $env:MSYS2_ROOT,
    "C:\msys64",
    "C:\tools\msys64",
    "D:\msys64",
    "E:\msys64"
) | Where-Object { $_ }

$MsysRoot = $null
foreach ($path in $PossibleMsysRoots) {
    if ($path -and (Test-Path (Join-Path $path "msys2_shell.cmd"))) {
        $MsysRoot = $path
        break
    }
}

if (-not $MsysRoot) {
    Write-Host "MSYS2 not found!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please install MSYS2 first (required to compile FFmpeg):" -ForegroundColor Yellow
    Write-Host "  1. Download: https://www.msys2.org/"
    Write-Host "  2. Install to C:\msys64 (recommended)"
    Write-Host "  3. Open 'MSYS2 MinGW 64-bit' from Start Menu"
    Write-Host "  4. Run: pacman -Syu"
    Write-Host ""
    Write-Host "After installing, re-run this script." -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Optional: Set environment variable MSYS2_ROOT if you installed elsewhere." -ForegroundColor DarkGray
    exit 1
}

Write-Host "Found MSYS2 at: $MsysRoot" -ForegroundColor Green

# Convert Windows path to MSYS2 path (e.g. C:\foo -> /c/foo)
$TargetMsys = $TargetDir -replace '^([A-Za-z]):', '/$1' -replace '\\', '/'
$ShScriptMsys = $ShScript -replace '^([A-Za-z]):', '/$1' -replace '\\', '/'

Write-Host "Target (MSYS2): $TargetMsys" -ForegroundColor DarkCyan

# Build the command that will run inside MSYS2
# We use mingw64 environment for proper 64-bit builds
$bashExe = Join-Path $MsysRoot "usr\bin\bash.exe"

if (-not (Test-Path $bashExe)) {
    Write-Error "Could not find bash.exe inside MSYS2. Your installation may be corrupted."
    exit 1
}

Write-Host ""
Write-Host "Launching build inside MSYS2 MinGW64 environment..." -ForegroundColor Cyan
Write-Host "This will install dependencies and compile. Go grab a coffee." -ForegroundColor Yellow
Write-Host ""

# Run the shell script inside MinGW64
# -l = login shell (loads profile)
# -c = command
$cleanFlag = ""
if ($Clean) {
    $cleanFlag = "--clean"
    Write-Host "Clean mode enabled - previous cache will be deleted" -ForegroundColor Yellow
}

$command = @"
cd / && source /etc/profile 2>/dev/null || true
export PATH="/mingw64/bin:`$PATH"
cd "$((Split-Path $ShScriptMsys -Parent))"
chmod +x build-ffmpeg-minimal.sh 2>/dev/null || true
./build-ffmpeg-minimal.sh "$TargetMsys" $cleanFlag
"@

try {
    & $bashExe -l -c $command
} catch {
    Write-Error "Build failed: $_"
    exit 1
}

Write-Host ""
Write-Host "=== Build process finished ===" -ForegroundColor Green

$finalExe = Join-Path $TargetDir "ffmpeg.exe"
if (Test-Path $finalExe) {
    $sizeMB = [math]::Round((Get-Item $finalExe).Length / 1MB, 1)
    Write-Host "Final minimal ffmpeg.exe size: $sizeMB MB" -ForegroundColor $(if ($sizeMB -lt 80) { "Green" } else { "Yellow" })
    Write-Host ""
    Write-Host "You can now build Beru with:" -ForegroundColor Cyan
    Write-Host "  npm run tauri:build" -ForegroundColor White
} else {
    Write-Warning "ffmpeg.exe was not found in the target directory after build."
}
