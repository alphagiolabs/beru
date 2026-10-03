param(
  [ValidateSet('signed', 'unsigned')]
  [string]$Mode = $(if ($env:CSC_LINK -or $env:WIN_CSC_LINK) { 'signed' } else { 'unsigned' }),
  [string]$Directory = (Join-Path $PSScriptRoot '../dist-installer')
)

$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Security') -ErrorAction Stop
$installers = @(Get-ChildItem -LiteralPath $Directory -Filter 'Beru-Setup-*.exe' -File)
if ($installers.Count -eq 0) { throw 'No installer found' }
foreach ($installer in $installers) {
  $signature = Get-AuthenticodeSignature -LiteralPath $installer.FullName
  Write-Host "Installer: $($installer.Name); signature: $($signature.Status); mode: $Mode"
  if ($Mode -eq 'signed' -and $signature.Status -ne 'Valid') {
    throw "Signed distribution requires a Valid Authenticode signature: $($installer.Name)"
  }
  if ($Mode -eq 'unsigned' -and $signature.Status -ne 'NotSigned') {
    throw "Unsigned distribution requires a NotSigned installer: $($installer.Name)"
  }
}
