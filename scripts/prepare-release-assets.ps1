param(
  [string]$OutputPath,
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version 3.0
$ProgressPreference = "SilentlyContinue"
. "$PSScriptRoot\build-common.ps1"

function Get-ReleaseArchiveName {
  param([string]$Arch)

  switch ($Arch) {
    "x64" { return "flget-win-x64.zip" }
    "aarch64" { return "flget-win-arm64.zip" }
    default { throw "Unsupported archive architecture: $Arch" }
  }
}

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$releaseRoot = [System.IO.Path]::GetFullPath($OutputPath)
$bunExe = Resolve-BunExe

if (-not $SkipBuild) {
  Push-Location $repoRoot
  try {
    Invoke-Checked { & $bunExe run build }
  } finally {
    Pop-Location
  }
}

if (Test-Path -LiteralPath $releaseRoot) {
  Get-ChildItem -LiteralPath $releaseRoot -Force -ErrorAction SilentlyContinue |
    Remove-Item -Recurse -Force
} else {
  New-Item -ItemType Directory -Path $releaseRoot | Out-Null
}

$commonAssets = @(
  @{ Source = (Join-Path $repoRoot "dist\flget.js"); Destination = "flget.js" },
  @{ Source = (Join-Path $repoRoot "dist\flget.js.map"); Destination = "flget.js.map" },
  @{ Source = (Join-Path $repoRoot "github-pages\activate.ps1"); Destination = "activate.ps1" },
  @{ Source = (Join-Path $repoRoot "github-pages\update.ps1"); Destination = "update.ps1" }
)

$sessionRoot = Join-Path $releaseRoot ".session"
New-Item -ItemType Directory -Force -Path $sessionRoot | Out-Null

Write-Host "==> Preparing release assets at $releaseRoot"
foreach ($arch in @("x64", "aarch64")) {
  $stageRoot = Join-Path $sessionRoot $arch
  New-Item -ItemType Directory -Force -Path $stageRoot | Out-Null

  foreach ($asset in $commonAssets) {
    if (-not (Test-Path -LiteralPath $asset.Source)) {
      throw "Release asset not found: $($asset.Source)"
    }

    $destinationPath = Join-Path $stageRoot $asset.Destination
    Copy-Item -LiteralPath $asset.Source -Destination $destinationPath -Force
  }

  $archivePath = Join-Path $releaseRoot (Get-ReleaseArchiveName -Arch $arch)
  if (Test-Path -LiteralPath $archivePath) {
    Remove-Item -LiteralPath $archivePath -Force
  }

  Push-Location $stageRoot
  try {
    Compress-Archive -Path * -DestinationPath $archivePath -CompressionLevel Optimal
  } finally {
    Pop-Location
  }
}

Remove-Item -LiteralPath $sessionRoot -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "Prepared release archives: $releaseRoot"
