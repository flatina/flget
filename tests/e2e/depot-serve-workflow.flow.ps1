param(
  [string]$BaseUrl,
  [string]$InstallRoot,
  [string]$ExpectedVersionOutput,
  [string]$DepotRoot,
  [int]$DepotServePort
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version 3.0
$ProgressPreference = "SilentlyContinue"
. "$PSScriptRoot\..\helpers\e2e-common.ps1"

# Start flget serve on the depot root
$bunExe = Join-Path $DepotRoot "bun.exe"
$cliPath = Join-Path $DepotRoot "flget.js"
$serveJob = & {
  Set-Location $DepotRoot
  & $bunExe $cliPath serve --port $DepotServePort --host 127.0.0.1
} &

# Wait for serve to be ready (poll until reachable)
$depotUrl = "http://127.0.0.1:$DepotServePort"
$deadline = (Get-Date).AddSeconds(10)
while ((Get-Date) -lt $deadline) {
  try {
    Invoke-RestMethod "$depotUrl/depot/index.json" -TimeoutSec 1 | Out-Null
    break
  } catch {
    Start-Sleep -Milliseconds 200
  }
}

try {
  # Verify serve is running — fetch index
  Invoke-Checked {
    $response = Invoke-RestMethod "$depotUrl/depot/index.json"
    if ($response.packages.Count -eq 0) { throw "Empty index" }
    Write-Output "index ok: $($response.packages.Count) packages"
  } -ExpectContains @("index ok")

  Push-Location $InstallRoot
  try {
    Invoke-Checked { Invoke-RestMethod "$BaseUrl/update.ps1" -OutFile ".\update.ps1"; Write-Output "downloaded" } -ExpectContains @("downloaded")
    Invoke-Checked { .\update.ps1 -BaseUrl $BaseUrl }
    Invoke-Checked { . .\activate.ps1; flget --version } -ExpectContains @($ExpectedVersionOutput)

    # Add remote depot
    Invoke-Checked { . .\activate.ps1; flget depot add $depotUrl } -ExpectContains @("Added depot")

    # Search in remote depot
    Invoke-Checked { . .\activate.ps1; flget search fldemo --source depot } -ExpectContains @("depot:fldemo")

    # Install from remote depot
    Invoke-Checked { . .\activate.ps1; flget install depot:fldemo } -ExpectContains @("Installed fldemo@1.0.0")

    # Verify installed package runs
    Invoke-Checked { . .\activate.ps1; fldemo } -ExpectContains @("serve-fldemo-1.0.0")

    # Verify stored as depot source type
    Invoke-Checked { . .\activate.ps1; flget list --json } -ExpectContains @('"sourceType": "depot"')

    Write-Host "depot serve workflow ok"
  } finally {
    Pop-Location
  }
} finally {
  $serveJob | Remove-Job -Force -ErrorAction SilentlyContinue
}
