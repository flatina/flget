param(
  [string]$BaseUrl,
  [string]$InstallRoot,
  [string]$ExpectedVersionOutput,
  [string]$NpmRegistryBaseUrl,
  [string]$BucketRepoPath,
  [ValidateSet("install", "update")]
  [string]$Phase
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version 3.0
$ProgressPreference = "SilentlyContinue"
. "$PSScriptRoot\..\helpers\e2e-common.ps1"

$env:FLGET_NPM_REGISTRY_BASE_URL = $NpmRegistryBaseUrl

Push-Location $InstallRoot
try {
  if ($Phase -eq "install") {
    Invoke-Checked { Invoke-RestMethod "$BaseUrl/update.ps1" -OutFile ".\update.ps1"; Write-Output "downloaded" } -ExpectContains @("downloaded")

    Invoke-Checked { .\update.ps1 -BaseUrl $BaseUrl }

    Invoke-Checked { . .\activate.ps1; flget --version } -ExpectContains @($ExpectedVersionOutput)

    Invoke-Checked { . .\activate.ps1; flget bucket add local $BucketRepoPath } -ExpectContains @("Added bucket local")

    Invoke-Checked { . .\activate.ps1; flget install scoop:local/demo } -ExpectContains @("Installed demo@1.0.0")

    Invoke-Checked { . .\activate.ps1; demo } -ExpectContains @("scoop-demo-v1")

    Invoke-Checked { . .\activate.ps1; flget install npm:demo } -ExpectContains @("Installed demo@1.0.0")

    Invoke-Checked { . .\activate.ps1; demo } -ExpectContains @("npm-demo-v1")

    Invoke-Checked { . .\activate.ps1; flget reset demo --source scoop } -ExpectContains @("Reset demo to scoop")

    Invoke-Checked { . .\activate.ps1; demo } -ExpectContains @("scoop-demo-v1")

    Write-Host "shared-id install phase ok"
    exit 0
  }

  Write-Host "==> update all packages without self-update"
  Invoke-Checked {
    . .\activate.ps1
    flget bucket update | Out-Null
    flget update --all --no-self
  } -ExpectContains @("Updated demo:")

  Invoke-Checked { . .\activate.ps1; demo } -ExpectContains @("scoop-demo-v2")

  Invoke-Checked { . .\activate.ps1; flget remove demo } -ExpectContains @("Removed demo")

  Invoke-Checked { . .\activate.ps1; demo } -ExpectContains @("npm-demo-v2")

  Write-Host "shared-id update phase ok"
} finally {
  Pop-Location
}
