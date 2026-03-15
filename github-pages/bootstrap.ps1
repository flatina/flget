#Requires -Version 5.1
[CmdletBinding()]
param(
  [string]$BaseUrl = "https://flatina.github.io/flget"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version 3.0

$normalizedBaseUrl = $BaseUrl.TrimEnd("/")
$tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("flget-bootstrap-" + [guid]::NewGuid().ToString("N"))
$updateScript = Join-Path $tempDir "update.ps1"

New-Item -ItemType Directory -Force -Path $tempDir | Out-Null

try {
  Invoke-WebRequest -Uri "$normalizedBaseUrl/update.ps1" -OutFile $updateScript
  & $updateScript -RootPath ([System.IO.Path]::GetFullPath((Get-Location).Path)) -BaseUrl $normalizedBaseUrl
  exit $LASTEXITCODE
} finally {
  Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
}
