$ProgressPreference = "SilentlyContinue"

function Ensure-Directory {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    New-Item -ItemType Directory -Path $Path | Out-Null
  }
}

function Write-Utf8NoBom {
  param(
    [string]$Path,
    [string]$Content
  )

  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $encoding)
}

function Get-Sha256Hex {
  param([string]$Path)

  $stream = [System.IO.File]::OpenRead($Path)
  try {
    $hashBytes = [System.Security.Cryptography.SHA256]::Create().ComputeHash($stream)
  } finally {
    $stream.Dispose()
  }

  return ([System.BitConverter]::ToString($hashBytes)).Replace("-", "").ToLowerInvariant()
}

function Get-FileUri {
  param([string]$Path)

  return ([System.Uri]([System.IO.Path]::GetFullPath($Path))).AbsoluteUri
}

function New-TarGzArchive {
  param(
    [string]$StageRoot,
    [string]$ArchivePath
  )

  if (Test-Path -LiteralPath $ArchivePath) {
    Remove-Item -LiteralPath $ArchivePath -Force
  }

  Push-Location $StageRoot
  try {
    & "$env:SystemRoot\System32\tar.exe" -czf $ArchivePath *
    if ($LASTEXITCODE -ne 0) {
      throw "tar failed for $ArchivePath"
    }
  } finally {
    Pop-Location
  }
}

function Initialize-GitRepo {
  param(
    [string]$RepoPath,
    [hashtable]$Files
  )

  Ensure-Directory $RepoPath
  foreach ($entry in $Files.GetEnumerator()) {
    $fullPath = Join-Path $RepoPath $entry.Key
    Ensure-Directory (Split-Path -Parent $fullPath)
    Write-Utf8NoBom -Path $fullPath -Content ([string]$entry.Value)
  }

  & git -c init.defaultBranch=main init $RepoPath | Out-Null
  & git -C $RepoPath config user.email "e2e@example.com"
  & git -C $RepoPath config user.name "E2E"
  & git -C $RepoPath config core.autocrlf false
  & git -C $RepoPath add .
  & git -C $RepoPath commit -m "init" | Out-Null
}

function New-ReleaseMetadataJson {
  param(
    [string]$Tag,
    [string]$ArchiveUrl
  )

  return (@{
    tag_name = $Tag
    name = $Tag
    draft = $false
    prerelease = $false
    assets = @(
      @{
        name = "flget-win-x64.zip"
        browser_download_url = $ArchiveUrl
      }
    )
  } | ConvertTo-Json -Depth 5)
}

function New-ScoopManifestJson {
  param(
    [string]$Version,
    [string]$Url,
    [string]$Hash,
    [string]$Target,
    [string]$ShimName
  )

  return @"
{
  "version": "$Version",
  "url": "$Url",
  "hash": "$Hash",
  "bin": [
    [
      "$Target",
      "$ShimName"
    ]
  ]
}
"@
}

function Initialize-BaseInstallEnvironment {
  param(
    [string]$RepoRoot,
    [string]$ServerRoot,
    [string]$InstallRoot,
    [string]$BaseUrl,
    [string]$ExpectedReleaseTag,
    [string]$BunExePath,
    [hashtable]$ExtraAssetFiles = @{}
  )

  $resolvedRepoRoot = [System.IO.Path]::GetFullPath($RepoRoot)
  $resolvedServerRoot = [System.IO.Path]::GetFullPath($ServerRoot)
  $resolvedInstallRoot = [System.IO.Path]::GetFullPath($InstallRoot)
  $normalizedBaseUrl = $BaseUrl.TrimEnd("/")

  Ensure-Directory $resolvedServerRoot
  Ensure-Directory $resolvedInstallRoot

  $downloadsRoot = Join-Path $resolvedServerRoot "downloads"
  $bunRoot = Join-Path $resolvedServerRoot "bun"
  $assetsRoot = Join-Path $resolvedServerRoot "assets"
  $releaseMetaLatestRoot = Join-Path $resolvedServerRoot "repos\flatina\flget\releases"
  $releaseMetaTagRoot = Join-Path $releaseMetaLatestRoot "tags"

  Ensure-Directory $downloadsRoot
  Ensure-Directory $bunRoot
  Ensure-Directory $assetsRoot
  Ensure-Directory $releaseMetaTagRoot

  foreach ($file in @("index.html", "update.ps1", "bootstrap.ps1")) {
    Copy-Item -LiteralPath (Join-Path $resolvedRepoRoot "github-pages\$file") -Destination (Join-Path $resolvedServerRoot $file) -Force
  }
  Copy-Item -LiteralPath (Join-Path $resolvedRepoRoot "LICENSE") -Destination (Join-Path $resolvedServerRoot "LICENSE") -Force

  $runtimeStageRoot = Join-Path $resolvedServerRoot "runtime-stage"
  Ensure-Directory $runtimeStageRoot
  foreach ($file in @("flget.js", "flget.js.map")) {
    Copy-Item -LiteralPath (Join-Path $resolvedRepoRoot "dist\$file") -Destination (Join-Path $runtimeStageRoot $file) -Force
  }
  foreach ($file in @("activate.ps1", "update.ps1")) {
    Copy-Item -LiteralPath (Join-Path $resolvedRepoRoot "github-pages\$file") -Destination (Join-Path $runtimeStageRoot $file) -Force
  }

  $runtimeArchivePath = Join-Path $downloadsRoot "flget-win-x64.zip"
  Push-Location $runtimeStageRoot
  try {
    Compress-Archive -Path * -DestinationPath $runtimeArchivePath -CompressionLevel Optimal -Force
  } finally {
    Pop-Location
  }

  $bunStageRoot = Join-Path $resolvedServerRoot "bun-stage"
  Ensure-Directory $bunStageRoot
  Copy-Item -LiteralPath $BunExePath -Destination (Join-Path $bunStageRoot "bun.exe") -Force

  $bunArchivePath = Join-Path $bunRoot "bun-windows-x64.zip"
  Push-Location $bunStageRoot
  try {
    Compress-Archive -Path * -DestinationPath $bunArchivePath -CompressionLevel Optimal -Force
  } finally {
    Pop-Location
  }

  $baseAssetFiles = @{
    "fldemo.cmd" = (Join-Path $resolvedRepoRoot "tests\assets\scoop\fldemo.cmd")
  }
  foreach ($entry in $ExtraAssetFiles.GetEnumerator()) {
    $baseAssetFiles[$entry.Key] = [string]$entry.Value
  }

  foreach ($entry in $baseAssetFiles.GetEnumerator()) {
    Copy-Item -LiteralPath $entry.Value -Destination (Join-Path $assetsRoot $entry.Key) -Force
  }

  $bucketRepoPath = Join-Path $resolvedServerRoot "bucket-main"
  $fldemoAssetPath = Join-Path $assetsRoot "fldemo.cmd"
  Initialize-GitRepo -RepoPath $bucketRepoPath -Files @{
    "bucket/fldemo.json" = (New-ScoopManifestJson `
      -Version "1.0.0" `
      -Url "$normalizedBaseUrl/assets/fldemo.cmd" `
      -Hash (Get-Sha256Hex $fldemoAssetPath) `
      -Target "fldemo.cmd" `
      -ShimName "fldemo") + "`n"
  }

  $compatRepoPath = Join-Path $resolvedServerRoot "compat"
  Initialize-GitRepo -RepoPath $compatRepoPath -Files @{
    "README.md" = "# flget-compat`n"
  }

  $releaseMetadata = New-ReleaseMetadataJson -Tag $ExpectedReleaseTag -ArchiveUrl "$normalizedBaseUrl/downloads/flget-win-x64.zip"
  Write-Utf8NoBom -Path (Join-Path $releaseMetaLatestRoot "latest") -Content $releaseMetadata
  Write-Utf8NoBom -Path (Join-Path $releaseMetaTagRoot $ExpectedReleaseTag) -Content $releaseMetadata

  return @{
    baseUrl = $normalizedBaseUrl
    installRoot = $resolvedInstallRoot
    serverRoot = $resolvedServerRoot
    assetsRoot = $assetsRoot
    bucketMainRepoPath = $bucketRepoPath
    compatRepoPath = $compatRepoPath
    env = @{
      FLGET_RELEASE_API_BASE_URL = $normalizedBaseUrl
      FLGET_RELEASE_OWNER = "flatina"
      FLGET_RELEASE_REPO = "flget"
      FLGET_BUN_DOWNLOAD_BASE_URL = "$normalizedBaseUrl/bun"
      GIT_CONFIG_COUNT = "2"
      GIT_CONFIG_KEY_0 = "url.$(Get-FileUri $bucketRepoPath).insteadOf"
      GIT_CONFIG_VALUE_0 = "https://github.com/ScoopInstaller/Main"
      GIT_CONFIG_KEY_1 = "url.$(Get-FileUri $compatRepoPath).insteadOf"
      GIT_CONFIG_VALUE_1 = "https://github.com/flatina/flget-compat"
    }
  }
}
