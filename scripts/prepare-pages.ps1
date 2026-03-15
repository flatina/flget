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

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$publishRoot = [System.IO.Path]::GetFullPath($OutputPath)
$bunExe = Resolve-BunExe

if (-not $SkipBuild) {
  Invoke-Checked -FilePath $bunExe -ArgumentList @("run", "build") -WorkingDirectory $repoRoot -Label "Building flget bundle"
}

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
  @{ Source = (Join-Path $repoRoot "github-pages\activate.ps1"); Destination = "activate.ps1" },
  @{ Source = (Join-Path $repoRoot "github-pages\REGISTER_PATH.ps1"); Destination = "REGISTER_PATH.ps1" },
  @{ Source = (Join-Path $repoRoot "dist\flget.js"); Destination = "dist\flget.js" },
  @{ Source = (Join-Path $repoRoot "dist\flget.js.map"); Destination = "dist\flget.js.map" },
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
Write-Host "Prepared Pages root: $publishRoot"
