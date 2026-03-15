#Requires -Version 5.1
[CmdletBinding()]
param(
  [string]$RootPath,
  [switch]$SkipBuild,
  [switch]$KeepRoot
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version 3.0
. (Join-Path $PSScriptRoot "deployed-test-common.ps1")

$deployRoot = if ($RootPath) {
  [System.IO.Path]::GetFullPath($RootPath)
} else {
  Join-Path ([System.IO.Path]::GetTempPath()) ("flget-deployed-npmgh-" + [guid]::NewGuid().ToString("N"))
}

$cleanupRoot = -not $KeepRoot.IsPresent
$deployScript = Join-Path $PSScriptRoot "deploy.ps1"
$packageRef = "antfu/ni"
$packageId = "ni"
$commandName = "ni"

try {
  & $deployScript -RootPath $deployRoot -SkipBuild:$SkipBuild

  $expectedShim = Join-Path $deployRoot "shims\$commandName.cmd"

  Push-Location $deployRoot
  try {
    Write-Host "==> Activating deployed root"
    . .\activate.ps1

    $flgetCommand = Get-Command flget -ErrorAction Stop
    Assert-StartsWithPath $flgetCommand.Source $deployRoot "flget should resolve from the deployed root"

    Invoke-Checked -FilePath $flgetCommand.Source -ArgumentList @("--version") -WorkingDirectory $deployRoot -Label "Checking flget version"
    Invoke-Checked -FilePath $flgetCommand.Source -ArgumentList @("install", $packageRef, "--source", "npmgh") -WorkingDirectory $deployRoot -Label "Installing npmgh package $packageRef"

    Write-Host "==> Re-activating deployed root after install"
    . .\activate.ps1

    $commandPath = ((& where.exe $commandName) | Select-Object -First 1).Trim()
    Assert-EqualPath $commandPath $expectedShim "npmgh command should resolve from the deployed root shims"

    Invoke-Checked -FilePath $expectedShim -ArgumentList @("--version") -WorkingDirectory $deployRoot -Label "Running $commandName shim --version"
    Assert-InstalledPackageId -FlgetCommandPath $flgetCommand.Source -PackageId $packageId

    Write-Host "==> Deployed npmgh test passed"
  } finally {
    Pop-Location
  }
} catch {
  $cleanupRoot = $false
  Write-Error $_
  Write-Host "Preserved deployed root: $deployRoot"
  exit 1
} finally {
  if ($cleanupRoot) {
    Write-Host "==> Cleaning up $deployRoot"
    Remove-Item -LiteralPath $deployRoot -Recurse -Force -ErrorAction SilentlyContinue
  } else {
    Write-Host "==> Keeping deployed root at $deployRoot"
  }
}
