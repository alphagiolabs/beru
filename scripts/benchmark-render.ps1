# Self-contained Beru render benchmark.
# Generates small synthetic clips, renders text overlays through python/processor.py,
# and prints elapsed time. Useful for comparing branches without user media files.
#
# Usage:
#   .\scripts\benchmark-render.ps1 -Count 3 -Duration 2 -Workers 2 -Profile fast

param(
  [int]$Count = 3,
  [int]$Duration = 2,
  [int]$Workers = 0,
  [string]$Profile = "fast"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Processor = Join-Path $Root "python\processor.py"
$Ffmpeg = Join-Path $Root "bin\ffmpeg.exe"
$Ffprobe = Join-Path $Root "bin\ffprobe.exe"

if (-not (Test-Path $Processor)) {
  Write-Error "processor.py not found at $Processor"
}
if (-not (Test-Path $Ffmpeg)) {
  Write-Error "ffmpeg.exe not found at $Ffmpeg"
}
if (-not (Test-Path $Ffprobe)) {
  Write-Error "ffprobe.exe not found at $Ffprobe"
}

$outDir = Join-Path $env:TEMP "beru-render-bench-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
New-Item -ItemType Directory -Path $outDir | Out-Null

$jobs = @()
for ($i = 0; $i -lt $Count; $i++) {
  $src = Join-Path $outDir "input-$i.mp4"
  $dst = Join-Path $outDir "output-$i.mp4"
  & $Ffmpeg `
    -hide_banner `
    -loglevel error `
    -y `
    -f lavfi `
    -i "testsrc=duration=$Duration`:size=640x360`:rate=30" `
    -f lavfi `
    -i "sine=frequency=$($i + 440):duration=$Duration" `
    -c:v libx264 `
    -preset ultrafast `
    -pix_fmt yuv420p `
    -c:a aac `
    $src
  if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to generate benchmark input $i"
  }

  $jobs += [ordered]@{
    id = $i
    input_path = $src
    output_path = $dst
    width = 640
    height = 360
    source_width = 640
    source_height = 360
    video_duration = $Duration
    video_codec = "h264"
    pix_fmt = "yuv420p"
    frame_rate = 30
    audio_codec = "aac"
    audio_channels = 1
    encode_profile = $Profile
    operations = @(
      [ordered]@{
        mode = "text"
        text = "BERU BENCH $i"
        font_size = 36
        font_color = "white"
        font_family = "Arial"
        bg_enabled = $true
        bg_color = "black"
        bg_opacity = 0.65
        box_border_width = 8
        region = [ordered]@{
          x = 32
          y = 32
          w = 320
          h = 72
        }
      }
    )
  }
}

$manifestPath = Join-Path $outDir "jobs.json"
$manifest = [ordered]@{
  type = "beru-job-manifest"
  version = 1
  createdAt = (Get-Date).ToUniversalTime().ToString("o")
  profile = $Profile
  jobs = $jobs
}
$manifestJson = $manifest | ConvertTo-Json -Depth 12
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[IO.File]::WriteAllText($manifestPath, $manifestJson, $utf8NoBom)

$oldWorkers = $env:BERU_WORKERS
$oldMode = $env:BERU_WORKERS_MODE
$oldRetry = $env:BERU_RETRY_FAILED
$oldFfmpeg = $env:BERU_FFMPEG
$oldFfprobe = $env:BERU_FFPROBE

try {
  $env:BERU_WORKERS = if ($Workers -gt 0) { "$Workers" } else { "0" }
  $env:BERU_WORKERS_MODE = "balanced"
  $env:BERU_RETRY_FAILED = "1"
  $env:BERU_FFMPEG = $Ffmpeg
  $env:BERU_FFPROBE = $Ffprobe

  Write-Host "Beru render benchmark"
  Write-Host "  Jobs    : $Count"
  Write-Host "  Duration: ${Duration}s"
  Write-Host "  Workers : $(if ($Workers -gt 0) { $Workers } else { 'auto' })"
  Write-Host "  Profile : $Profile"
  Write-Host "  Output  : $outDir"

  $sw = [Diagnostics.Stopwatch]::StartNew()
  if (Get-Command py -ErrorAction SilentlyContinue) {
    & py -3 $Processor $manifestPath
  } else {
    & python $Processor $manifestPath
  }
  $code = $LASTEXITCODE
  $sw.Stop()

  Write-Host "Exit code: $code"
  Write-Host "Elapsed  : $($sw.Elapsed.TotalSeconds.ToString('0.0'))s"
  Write-Host "Outputs  : $outDir"
  exit $code
} finally {
  $env:BERU_WORKERS = $oldWorkers
  $env:BERU_WORKERS_MODE = $oldMode
  $env:BERU_RETRY_FAILED = $oldRetry
  $env:BERU_FFMPEG = $oldFfmpeg
  $env:BERU_FFPROBE = $oldFfprobe
}
