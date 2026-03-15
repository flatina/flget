#Requires -Version 5.1
[CmdletBinding()]
param(
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version 3.0

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$scripts = @(
  "test-deployed-nodejs.ps1",
  "test-deployed-scoop.ps1",
  "test-deployed-npm.ps1",
  "test-deployed-ghr.ps1",
  "test-deployed-npmgh.ps1"
)

if (-not $SkipBuild) {
  Write-Host "==> Building flget bundle"
  Push-Location $repoRoot
  try {
    bun run build
    if ($LASTEXITCODE -ne 0) {
      throw "bun run build failed with exit code ${LASTEXITCODE}"
    }
  } finally {
    Pop-Location
  }
}

foreach ($script in $scripts) {
  $scriptPath = Join-Path $PSScriptRoot $script
  Write-Host "==> Running $script"
  & $scriptPath -SkipBuild
}
