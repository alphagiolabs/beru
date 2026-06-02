# Benchmark Beru batch throughput (local maintainer script).
# Usage:
#   .\scripts\benchmark-batch.ps1 -InputDir "C:\videos\clips" -Count 5 -Workers 5

param(
  [string]$InputDir = "",
  [int]$Count = 5,
  [int]$Workers = 0,
  [string]$Profile = "fast"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Processor = Join-Path $Root "python\processor.py"

if (-not (Test-Path $Processor)) {
  Write-Error "processor.py not found at $Processor"
}

$videos = @()
if ($InputDir -and (Test-Path $InputDir)) {
  $videos = Get-ChildItem -Path $InputDir -File -Include *.mp4,*.mov,*.mkv |
    Select-Object -First $Count -ExpandProperty FullName
}

if ($videos.Count -eq 0) {
  Write-Host "No input videos. Pass -InputDir with at least one clip."
  Write-Host "Example: .\scripts\benchmark-batch.ps1 -InputDir C:\clips -Count 5 -Workers 5"
  exit 1
}

$outDir = Join-Path $env:TEMP "beru-bench-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
New-Item -ItemType Directory -Path $outDir | Out-Null

$jobs = @()
for ($i = 0; $i -lt $videos.Count; $i++) {
  $src = $videos[$i]
  $name = [IO.Path]::GetFileNameWithoutExtension($src)
  $jobs += @{
    id = $i
    input_path = $src
    output_path = (Join-Path $outDir "$name`_bench.mp4")
    encode_profile = $Profile
    operations = @()
  }
}

$manifest = Join-Path $outDir "jobs.json"
$jobs | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 $manifest

$env:BERU_WORKERS = if ($Workers -gt 0) { "$Workers" } else { "0" }
$env:BERU_WORKERS_MODE = "balanced"
$env:BERU_RETRY_FAILED = "1"

Write-Host "Beru batch benchmark"
Write-Host "  Videos : $($jobs.Count)"
Write-Host "  Workers: $(if ($Workers -gt 0) { $Workers } else { 'auto' })"
Write-Host "  Output : $outDir"

$sw = [Diagnostics.Stopwatch]::StartNew()
$py = if (Get-Command py -ErrorAction SilentlyContinue) { "py" } else { "python" }
& $py -3 $Processor $manifest
$code = $LASTEXITCODE
$sw.Stop()

Write-Host "Exit code: $code"
Write-Host "Elapsed  : $($sw.Elapsed.TotalSeconds.ToString('0.0'))s"
Write-Host "Outputs  : $outDir"