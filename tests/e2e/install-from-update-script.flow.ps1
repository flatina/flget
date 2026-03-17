param(
  [string]$BaseUrl,
  [string]$InstallRoot,
  [string]$ExpectedVersionOutput
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

  Invoke-Checked { . .\activate.ps1; flget search jq --source scoop } -ExpectContains @("scoop:main/jq (1.0.0)")

  Invoke-Checked { . .\activate.ps1; flget install jq --source scoop } -ExpectContains @("Installed jq@1.0.0")

  Invoke-Checked { . .\activate.ps1; jq --version } -ExpectContains @("jq-1.0.0")

  Write-Host "black-box installer ok"
} finally {
  Pop-Location
}
