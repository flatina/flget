param(
  [string]$BaseUrl,
  [string]$InstallRoot,
  [string]$ExpectedVersionOutput,
  [string]$DepotRoot
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version 3.0
$ProgressPreference = "SilentlyContinue"
. "$PSScriptRoot\..\helpers\e2e-common.ps1"

Push-Location $InstallRoot
try {
  Invoke-Checked { Invoke-RestMethod "$BaseUrl/update.ps1" -OutFile ".\update.ps1"; Write-Output "downloaded" } -ExpectContains @("downloaded")

  Invoke-Checked { .\update.ps1 -BaseUrl $BaseUrl }

  Invoke-Checked { . .\activate.ps1; flget --version } -ExpectContains @($ExpectedVersionOutput)

  # Add local depot
  Invoke-Checked { . .\activate.ps1; flget depot add $DepotRoot } -ExpectContains @("Added depot")

  # Verify depot list
  Invoke-Checked { . .\activate.ps1; flget depot list } -ExpectContains @("depot-source")

  # Search in depot
  Invoke-Checked { . .\activate.ps1; flget search fldemo --source depot } -ExpectContains @("depot:fldemo")

  # Install from depot
  Invoke-Checked { . .\activate.ps1; flget install depot:fldemo } -ExpectContains @("Installed fldemo@1.0.0")

  # Verify installed package runs
  Invoke-Checked { . .\activate.ps1; fldemo } -ExpectContains @("depot-fldemo-1.0.0")

  # Verify it's stored as depot source type
  Invoke-Checked { . .\activate.ps1; flget list --json } -ExpectContains @('"sourceType": "depot"')

  Write-Host "depot local workflow ok"
} finally {
  Pop-Location
}
