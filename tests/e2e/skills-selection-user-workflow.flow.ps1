param(
  [string]$BaseUrl,
  [string]$InstallRoot,
  [string]$ExpectedVersionOutput,
  [string]$GitHubApiBaseUrl
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

  Invoke-Checked { . .\activate.ps1; flget --version } -ExpectContains @($ExpectedVersionOutput)

  Invoke-Checked { . .\activate.ps1; flget skills find test-skill } -ExpectContains @("skill:mock/test-skill")

  Invoke-Checked { . .\activate.ps1; flget skills add mock/test-skill --list } -ExpectContains @("cowsay-ts", "hello-ts")

  Invoke-ExpectedFailure { . .\activate.ps1; flget skills add mock/test-skill } -ExpectContains @("Multiple skills found", "--skill", "--all", "--list")

  Invoke-Checked { . .\activate.ps1; flget skills add mock/test-skill --skill cowsay-ts } -ExpectContains @("Installed cowsay-ts@")

  Invoke-Checked { . .\activate.ps1; cowsay } -ExpectContains @("moo")

  Invoke-ExpectedFailure { . .\activate.ps1; hello } -ExpectContains @("not recognized")

  Invoke-Checked { . .\activate.ps1; flget skills rm cowsay-ts } -ExpectContains @("Removed cowsay-ts")

  Invoke-Checked { . .\activate.ps1; flget skills add mock/test-skill --all } -ExpectContains @("Installed cowsay-ts@", "Installed hello-ts@")

  Invoke-Checked { . .\activate.ps1; flget skills list } -ExpectContains @("cowsay-ts", "hello-ts")

  Invoke-Checked { . .\activate.ps1; hello } -ExpectContains @("hello")

  Write-Host "skills selection workflow ok"
} finally {
  Pop-Location
}
