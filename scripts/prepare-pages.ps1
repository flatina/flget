param(
  [string]$OutputPath
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version 3.0
$ProgressPreference = "SilentlyContinue"

if (-not $OutputPath) {
  throw "OutputPath is required"
}

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$publishRoot = [System.IO.Path]::GetFullPath($OutputPath)

if (Test-Path -LiteralPath $publishRoot) {
  Get-ChildItem -LiteralPath $publishRoot -Force -ErrorAction SilentlyContinue |
    Remove-Item -Recurse -Force
} else {
  New-Item -ItemType Directory -Path $publishRoot | Out-Null
}

$assets = @(
  @{ Source = (Join-Path $repoRoot "github-pages\index.html"); Destination = "index.html" },
  @{ Source = (Join-Path $repoRoot "github-pages\update.ps1"); Destination = "update.ps1" },
  @{ Source = (Join-Path $repoRoot "github-pages\bootstrap.ps1"); Destination = "bootstrap.ps1" },
  @{ Source = (Join-Path $repoRoot "LICENSE"); Destination = "LICENSE" }
)

Write-Host "==> Preparing Pages staging root at $publishRoot"
foreach ($asset in $assets) {
  if (-not (Test-Path -LiteralPath $asset.Source)) {
    throw "Pages asset not found: $($asset.Source)"
  }

  $destinationPath = Join-Path $publishRoot $asset.Destination
  $destinationDir = Split-Path -Parent $destinationPath
  if ($destinationDir -and -not (Test-Path -LiteralPath $destinationDir)) {
    New-Item -ItemType Directory -Path $destinationDir -Force | Out-Null
  }

  Copy-Item -LiteralPath $asset.Source -Destination $destinationPath -Force
}

Set-Content -LiteralPath (Join-Path $publishRoot ".nojekyll") -Value "" -NoNewline

$packageJson = Get-Content (Join-Path $repoRoot "package.json") | ConvertFrom-Json
$versionJson = @{
  scriptVersion = 1
  flgetVersion = $packageJson.version
} | ConvertTo-Json
Set-Content -LiteralPath (Join-Path $publishRoot "version.json") -Encoding UTF8 -Value $versionJson

# Individual runtime files for direct download
$downloadsDir = Join-Path $publishRoot "downloads"
New-Item -ItemType Directory -Path $downloadsDir -Force | Out-Null

$distDir = Join-Path $repoRoot "dist"
foreach ($name in @("flget.js", "flget.js.map")) {
  $source = Join-Path $distDir $name
  if (-not (Test-Path $source)) {
    throw "Build artifact not found: $source (run 'bun run build' first)"
  }
  Copy-Item $source (Join-Path $downloadsDir $name)
}
foreach ($name in @("activate.ps1", "update.ps1")) {
  Copy-Item (Join-Path $repoRoot "github-pages\$name") (Join-Path $downloadsDir $name)
}

Write-Host "Prepared Pages root: $publishRoot"
