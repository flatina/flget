param(
  [string]$BaseUrl,
  [string]$InstallRoot,
  [string]$ExpectedVersionOutput,
  [string]$GitHubApiBaseUrl,
  [string]$NpmRegistryBaseUrl
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version 3.0
$ProgressPreference = "SilentlyContinue"
. "$PSScriptRoot\..\helpers\e2e-common.ps1"

Push-Location $InstallRoot
try {
  Invoke-Checked { Invoke-RestMethod "$BaseUrl/update.ps1" -OutFile ".\update.ps1"; Write-Output "downloaded" } -ExpectContains @("downloaded")

  Invoke-Checked { .\update.ps1 -BaseUrl $BaseUrl }

  $env:FLGET_GITHUB_API_BASE_URL = $GitHubApiBaseUrl
  $env:FLGET_NPM_REGISTRY_BASE_URL = $NpmRegistryBaseUrl

  Invoke-Checked { . .\activate.ps1; flget --version } -ExpectContains @($ExpectedVersionOutput)

  Invoke-Checked { . .\activate.ps1; flget install jq --source scoop } -ExpectContains @("Installed jq@1.0.0")

  Invoke-Checked { . .\activate.ps1; jq --version } -ExpectContains @("jq-1.0.0")

  Invoke-Checked { . .\activate.ps1; flget install npm:mock-npm-cli } -ExpectContains @("Installed mock-npm-cli@1.0.0")

  Invoke-Checked { . .\activate.ps1; mock-npm } -ExpectContains @("npm-v1")

  Invoke-Checked { . .\activate.ps1; flget fund mock-npm-cli } -ExpectContains @("https://github.com/sponsors/mocknpm", "Support mock npm")

  Write-Host "==> write local github-release override"
  Invoke-Checked {
    New-Item -ItemType Directory -Force -Path ".\tmp\registries\local\overrides\github-release" | Out-Null
    Set-Content -LiteralPath ".\tmp\registries\local\overrides\github-release\mock--test-ghr.toml" -Encoding UTF8 -Value @'
[[bin]]
name = "test-ghr-windows"
target = "test-ghr-windows.cmd"
'@
  }

  Invoke-Checked { . .\activate.ps1; flget install ghr:mock/test-ghr } -ExpectContains @("Installed test-ghr@v1.0.0")

  Invoke-Checked { . .\activate.ps1; test-ghr-windows } -ExpectContains @("ghr-v1")

  Invoke-Checked { . .\activate.ps1; flget install npmgh:mock/test-npm } -ExpectContains @("Installed test-npm@v1.0.0")

  Invoke-Checked { . .\activate.ps1; mock-npmgh } -ExpectContains @("npmgh-v1")

  Invoke-Checked { . .\activate.ps1; flget skills add mock/test-skill --skill cowsay-ts } -ExpectContains @("Installed cowsay-ts@")

  Invoke-Checked { . .\activate.ps1; cowsay } -ExpectContains @("moo")

  Write-Host "black-box multi-source workflow ok"
} finally {
  Pop-Location
}
