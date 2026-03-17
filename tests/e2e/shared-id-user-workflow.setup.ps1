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
  -BunExePath $BunExePath `
  -ExtraAssetFiles @{
    "demo-v1.cmd" = (Join-Path $RepoRoot "tests\assets\scoop\demo-v1.cmd")
    "demo-v2.cmd" = (Join-Path $RepoRoot "tests\assets\scoop\demo-v2.cmd")
  }

$stateRoot = Join-Path $ServerRoot "state"
Ensure-Directory $stateRoot

$demoV1Archive = Join-Path $stateRoot "demo-1.0.0.tgz"
New-TarGzArchive -StageRoot (Join-Path $RepoRoot "tests\assets\npm\demo-v1") -ArchivePath $demoV1Archive

$npmStatePath = Join-Path $stateRoot "npm-state.json"
$bucketRepoPath = Join-Path $ServerRoot "bucket-local"

Initialize-GitRepo -RepoPath $bucketRepoPath -Files @{
  "bucket/demo.json" = (New-ScoopManifestJson `
    -Version "1.0.0" `
    -Url "$BaseUrl/assets/demo-v1.cmd" `
    -Hash (Get-Sha256Hex (Join-Path $setup.assetsRoot "demo-v1.cmd")) `
    -Target "demo-v1.cmd" `
    -ShimName "demo") + "`n"
}

$npmState = @{
  packages = @{
    "demo" = @{
      latest = "1.0.0"
      versions = @{
        "1.0.0" = $demoV1Archive
      }
    }
  }
}

Write-Utf8NoBom -Path $npmStatePath -Content ($npmState | ConvertTo-Json -Depth 12)

$result = @{
  baseUrl = $setup.baseUrl
  installRoot = $setup.installRoot
  env = $setup.env
  bucketRepoPath = $bucketRepoPath
  npmStatePath = $npmStatePath
}

Ensure-Directory (Split-Path -Parent ([System.IO.Path]::GetFullPath($OutFile)))
Write-Utf8NoBom -Path ([System.IO.Path]::GetFullPath($OutFile)) -Content ($result | ConvertTo-Json -Depth 12)
