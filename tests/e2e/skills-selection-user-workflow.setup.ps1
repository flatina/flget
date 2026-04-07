param(
  [string]$RepoRoot,
  [string]$ServerRoot,
  [string]$InstallRoot,
  [string]$BaseUrl,
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
  -BunExePath $BunExePath

$stateRoot = Join-Path $ServerRoot "state"
Ensure-Directory $stateRoot

$skillSha = "dededededededededededededededededededede"
$skillArchive = Join-Path $stateRoot "test-skill-$skillSha.tgz"
New-TarGzArchive -StageRoot (Join-Path $RepoRoot "tests\assets\skills\test-skill") -ArchivePath $skillArchive

$githubStatePath = Join-Path $stateRoot "github-state.json"
$githubState = @{
  repositories = @{
    "mock/test-skill" = @{
      defaultBranch = "main"
      description = "skill search target"
    }
  }
  commits = @{
    "mock/test-skill" = @{
      main = $skillSha
    }
  }
  tarballs = @{
    "mock/test-skill" = @{
      $skillSha = $skillArchive
    }
  }
  searchRepositories = @(
    @{
      owner = "mock"
      repo = "test-skill"
      description = "skill search target"
    }
  )
}

Write-Utf8NoBom -Path $githubStatePath -Content ($githubState | ConvertTo-Json -Depth 12)

$result = @{
  baseUrl = $setup.baseUrl
  installRoot = $setup.installRoot
  env = $setup.env
  githubStatePath = $githubStatePath
}

Ensure-Directory (Split-Path -Parent ([System.IO.Path]::GetFullPath($OutFile)))
Write-Utf8NoBom -Path ([System.IO.Path]::GetFullPath($OutFile)) -Content ($result | ConvertTo-Json -Depth 12)
