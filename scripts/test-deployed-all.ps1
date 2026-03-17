param(
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version 3.0
$ProgressPreference = "SilentlyContinue"

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$scripts = @(
  "test-deployed-nodejs.ps1",
  "test-deployed-scoop.ps1",
  "test-deployed-npm.ps1",
  "test-deployed-ghr.ps1",
  "test-deployed-npmgh.ps1",
  "test-deployed-skills.ps1"
)

if (-not $SkipBuild) {
  Push-Location $repoRoot
  try {
    Write-Host "==> bun run build"
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
  Write-Host "==> .\\$script -SkipBuild"
  & powershell -NoProfile -ExecutionPolicy Bypass -File $scriptPath -SkipBuild
  if ($LASTEXITCODE -ne 0) {
    throw "$script failed with exit code ${LASTEXITCODE}"
  }
}
