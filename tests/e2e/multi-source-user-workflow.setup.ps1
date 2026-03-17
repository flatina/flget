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

$stateRoot = Join-Path $ServerRoot "state"
Ensure-Directory $stateRoot

$mockNpmArchive = Join-Path $stateRoot "mock-npm-cli-1.0.0.tgz"
New-TarGzArchive -StageRoot (Join-Path $RepoRoot "tests\assets\npm\mock-npm-cli") -ArchivePath $mockNpmArchive

$npmghArchive = Join-Path $stateRoot "test-npm-v1.0.0.tgz"
New-TarGzArchive -StageRoot (Join-Path $RepoRoot "tests\assets\npmgh\test-npm") -ArchivePath $npmghArchive

$skillSha = "1111111111111111111111111111111111111111"
$skillArchive = Join-Path $stateRoot "test-skill-$skillSha.tgz"
New-TarGzArchive -StageRoot (Join-Path $RepoRoot "tests\assets\skills\test-skill") -ArchivePath $skillArchive

$githubStatePath = Join-Path $stateRoot "github-state.json"
$npmStatePath = Join-Path $stateRoot "npm-state.json"

$githubState = @{
  releaseRepositories = @{
    "mock/test-ghr" = @{
      latest = @{
        tag_name = "v1.0.0"
        name = "v1.0.0"
        draft = $false
        prerelease = $false
        assets = @(
          @{
            name = "test-ghr-windows.cmd"
            browser_download_url = "/assets/releases/test-ghr-windows.cmd"
          }
        )
      }
      tags = @{
        "v1.0.0" = @{
          tag_name = "v1.0.0"
          name = "v1.0.0"
          draft = $false
          prerelease = $false
          assets = @(
            @{
              name = "test-ghr-windows.cmd"
              browser_download_url = "/assets/releases/test-ghr-windows.cmd"
            }
          )
        }
      }
    }
    "mock/test-npm" = @{
      latest = @{
        tag_name = "v1.0.0"
        name = "v1.0.0"
        draft = $false
        prerelease = $false
        assets = @()
      }
      tags = @{
        "v1.0.0" = @{
          tag_name = "v1.0.0"
          name = "v1.0.0"
          draft = $false
          prerelease = $false
          assets = @()
        }
      }
    }
  }
  commits = @{
    "mock/test-skill" = @{
      main = $skillSha
    }
  }
  tarballs = @{
    "mock/test-npm" = @{
      "v1.0.0" = $npmghArchive
    }
    "mock/test-skill" = @{
      $skillSha = $skillArchive
    }
  }
  assetFiles = @{
    "releases/test-ghr-windows.cmd" = (Join-Path $RepoRoot "tests\assets\ghr\test-ghr\test-ghr-windows.cmd")
  }
}

$npmState = @{
  packages = @{
    "mock-npm-cli" = @{
      latest = "1.0.0"
      versions = @{
        "1.0.0" = $mockNpmArchive
      }
    }
  }
}

Write-Utf8NoBom -Path $githubStatePath -Content ($githubState | ConvertTo-Json -Depth 12)
Write-Utf8NoBom -Path $npmStatePath -Content ($npmState | ConvertTo-Json -Depth 12)

$result = @{
  baseUrl = $setup.baseUrl
  installRoot = $setup.installRoot
  env = $setup.env
  githubStatePath = $githubStatePath
  npmStatePath = $npmStatePath
}

Ensure-Directory (Split-Path -Parent ([System.IO.Path]::GetFullPath($OutFile)))
Write-Utf8NoBom -Path ([System.IO.Path]::GetFullPath($OutFile)) -Content ($result | ConvertTo-Json -Depth 12)
