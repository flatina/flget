param(
  [string]$RepoRoot,
  [string]$ServerRoot,
  [string]$InstallRoot,
  [string]$BaseUrl,
  [string]$ExpectedReleaseTag,
  [string]$BunExePath,
  [string]$OutFile
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version 3.0
$ProgressPreference = "SilentlyContinue"
. "$PSScriptRoot\..\helpers\e2e-setup-common.ps1"

$setup = Initialize-BaseInstallEnvironment `
  -RepoRoot $RepoRoot `
  -ServerRoot $ServerRoot `
  -InstallRoot $InstallRoot `
  -BaseUrl $BaseUrl `
  -ExpectedReleaseTag $ExpectedReleaseTag `
  -BunExePath $BunExePath

Ensure-Directory (Split-Path -Parent ([System.IO.Path]::GetFullPath($OutFile)))
Write-Utf8NoBom -Path ([System.IO.Path]::GetFullPath($OutFile)) -Content ($setup | ConvertTo-Json -Depth 8)
