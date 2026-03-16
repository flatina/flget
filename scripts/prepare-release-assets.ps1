#Requires -Version 5.1
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$OutputPath,
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version 3.0

function Invoke-Checked {
  param(
    [string]$FilePath,
    [string[]]$ArgumentList,
    [string]$WorkingDirectory,
    [string]$Label
  )

  Write-Host "==> $Label"
  Push-Location $WorkingDirectory
  try {
    & $FilePath @ArgumentList
    if ($LASTEXITCODE -ne 0) {
      throw "Command failed with exit code ${LASTEXITCODE}: $FilePath $($ArgumentList -join ' ')"
    }
  } finally {
    Pop-Location
  }
}

function Resolve-BunExe {
  $bunCommand = Get-Command bun -ErrorAction Stop
  $bunSource = $bunCommand.Source
  if ($bunSource -notlike "*.exe") {
    $candidate = Join-Path (Split-Path -Parent $bunSource) "bun.exe"
    if (Test-Path -LiteralPath $candidate) {
      $bunSource = $candidate
    }
  }
  if (-not (Test-Path -LiteralPath $bunSource)) {
    throw "bun executable not found: $bunSource"
  }
  return $bunSource
}

function Get-BunAssetName {
  param([string]$Arch)

  switch ($Arch) {
    "x64" { return "bun-windows-x64.zip" }
    "aarch64" { return "bun-windows-aarch64.zip" }
    default { throw "Unsupported archive architecture: $Arch" }
  }
}

function Get-ReleaseArchiveName {
  param([string]$Arch)

  switch ($Arch) {
    "x64" { return "flget-windows-x64.zip" }
    "aarch64" { return "flget-windows-aarch64.zip" }
    default { throw "Unsupported archive architecture: $Arch" }
  }
}

function Download-File {
  param(
    [string]$Url,
    [string]$OutFile
  )

  Invoke-WebRequest -Uri $Url -OutFile $OutFile
}

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$releaseRoot = [System.IO.Path]::GetFullPath($OutputPath)
$bunExe = Resolve-BunExe

if (-not $SkipBuild) {
  Invoke-Checked -FilePath $bunExe -ArgumentList @("run", "build") -WorkingDirectory $repoRoot -Label "Building flget bundle"
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
  @{ Source = (Join-Path $repoRoot "github-pages\REGISTER_PATH.ps1"); Destination = "REGISTER_PATH.ps1" },
  @{ Source = (Join-Path $repoRoot "github-pages\update.ps1"); Destination = "update.ps1" }
)

$bunDownloadBaseUrl = if ($env:FLGET_BUN_DOWNLOAD_BASE_URL) {
  $env:FLGET_BUN_DOWNLOAD_BASE_URL.TrimEnd("/")
} else {
  "https://github.com/oven-sh/bun/releases/latest/download"
}
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

  $bunArchive = Join-Path $sessionRoot (Get-BunAssetName -Arch $arch)
  $bunExtract = Join-Path $sessionRoot ("bun-" + $arch)
  $bunExePath = Join-Path $stageRoot "bun.exe"

  Write-Host "==> Downloading Bun runtime for $arch"
  Download-File -Url "$bunDownloadBaseUrl/$(Get-BunAssetName -Arch $arch)" -OutFile $bunArchive
  Expand-Archive -LiteralPath $bunArchive -DestinationPath $bunExtract -Force

  $downloadedBun = Get-ChildItem -Path $bunExtract -Filter bun.exe -Recurse | Select-Object -First 1 -ExpandProperty FullName
  if (-not $downloadedBun) {
    throw "bun.exe not found in downloaded archive for $arch"
  }
  Copy-Item -LiteralPath $downloadedBun -Destination $bunExePath -Force

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
