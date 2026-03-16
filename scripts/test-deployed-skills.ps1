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
  Join-Path ([System.IO.Path]::GetTempPath()) ("flget-deployed-skills-" + [guid]::NewGuid().ToString("N"))
}

$cleanupRoot = -not $KeepRoot.IsPresent
$deployScript = Join-Path $PSScriptRoot "deploy.ps1"
$skillRepo = "flatina/skills"
$skillId = "cowsay-ts"
$skillShim = "cowsay"

try {
  & $deployScript -RootPath $deployRoot -SkipBuild:$SkipBuild

  $expectedShim = Join-Path $deployRoot "shims\$skillShim.cmd"
  $expectedSkillRoot = Join-Path $deployRoot "agents\skills\$skillId\current"

  Push-Location $deployRoot
  try {
    Write-Host "==> Activating deployed root"
    . .\activate.ps1

    $flgetCommand = Get-Command flget -ErrorAction Stop
    Assert-StartsWithPath $flgetCommand.Source $deployRoot "flget should resolve from the deployed root"

    Invoke-Checked -FilePath $flgetCommand.Source -ArgumentList @("--version") -WorkingDirectory $deployRoot -Label "Checking flget version"
    Invoke-Checked -FilePath $flgetCommand.Source -ArgumentList @("skills", "install", $skillRepo, "--list") -WorkingDirectory $deployRoot -Label "Listing skills from $skillRepo"
    Invoke-Checked -FilePath $flgetCommand.Source -ArgumentList @("skills", "install", $skillRepo, "--skill", $skillId) -WorkingDirectory $deployRoot -Label "Installing skill $skillId from $skillRepo"

    Write-Host "==> Re-activating deployed root after install"
    . .\activate.ps1

    $shimPath = ((& where.exe $skillShim) | Select-Object -First 1).Trim()
    Assert-EqualPath $shimPath $expectedShim "skill shim should resolve from the deployed root shims"

    if (-not (Test-Path -LiteralPath $expectedSkillRoot)) {
      throw "Installed skill root was not created under the deployed root: $expectedSkillRoot"
    }

    $skillListJson = & $flgetCommand.Source skills list --json
    if ($LASTEXITCODE -ne 0) {
      throw "Unable to read installed skill list."
    }
    $skillList = $skillListJson | ConvertFrom-Json
    if (-not ($skillList | Where-Object { $_.id -eq $skillId })) {
      throw "Installed skill list does not contain $skillId."
    }

    Invoke-Checked -FilePath $expectedShim -ArgumentList @("hello from deployed skills test") -WorkingDirectory $deployRoot -Label "Running $skillShim shim"

    Write-Host "==> Deployed skills test passed"
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
