#Requires -Version 5.1
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$RootPath,
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
$deployRoot = [System.IO.Path]::GetFullPath($RootPath)

if (Test-Path -LiteralPath $deployRoot) {
  $existingEntry = Get-ChildItem -LiteralPath $deployRoot -Force -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($existingEntry) {
    throw "RootPath already exists and is not empty: $deployRoot"
  }
} else {
  New-Item -ItemType Directory -Force -Path $deployRoot | Out-Null
}

$bunExe = Resolve-BunExe

if (-not $SkipBuild) {
  Invoke-Checked -FilePath $bunExe -ArgumentList @("run", "build") -WorkingDirectory $repoRoot -Label "Building flget bundle"
}

Write-Host "==> Preparing deployed root at $deployRoot"
$assets = @(
  @{ Source = (Join-Path $repoRoot "dist\flget.js"); Destination = (Join-Path $deployRoot "flget.js") },
  @{ Source = (Join-Path $repoRoot "dist\flget.js.map"); Destination = (Join-Path $deployRoot "flget.js.map") },
  @{ Source = (Join-Path $repoRoot "github-pages\activate.ps1"); Destination = (Join-Path $deployRoot "activate.ps1") },
  @{ Source = (Join-Path $repoRoot "github-pages\update.ps1"); Destination = (Join-Path $deployRoot "update.ps1") },
  @{ Source = (Join-Path $repoRoot "github-pages\REGISTER_PATH.ps1"); Destination = (Join-Path $deployRoot "REGISTER_PATH.ps1") },
  @{ Source = $bunExe; Destination = (Join-Path $deployRoot "bun.exe") }
)

foreach ($asset in $assets) {
  if (-not (Test-Path -LiteralPath $asset.Source)) {
    throw "Deploy asset not found: $($asset.Source)"
  }
  Copy-Item -LiteralPath $asset.Source -Destination $asset.Destination -Force
}

Write-Host "Deployed root: $deployRoot"
