#Requires -Version 5.1
param(
  [string]$BaseUrl = "https://flatina.github.io/flget",
  [string]$RootPath,
  [switch]$ApplyDownloadedUpdate,
  [string]$ReleaseTag
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version 3.0
$ProgressPreference = "SilentlyContinue"

function New-SessionId {
  $ts = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds().ToString("x")
  $rnd = "{0:x8}" -f (Get-Random -Maximum ([int]::MaxValue))
  return "$ts-$rnd"
}

function Write-Step {
  param([string]$Message)
  Write-Host "==> $Message"
}

function Ensure-Directory {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) {
    New-Item -ItemType Directory -Path $Path | Out-Null
  }
}

function Get-ReleaseArchiveName {
  $arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture
  switch ($arch.ToString()) {
    "Arm64" { return "flget-win-arm64.zip" }
    "X64" { return "flget-win-x64.zip" }
    default { throw "Unsupported Windows architecture: $arch" }
  }
}

function Get-BunAssetName {
  $arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture
  switch ($arch.ToString()) {
    "Arm64" { return "bun-windows-aarch64.zip" }
    "X64" { return "bun-windows-x64.zip" }
    default { throw "Unsupported Windows architecture: $arch" }
  }
}

function Get-ReleaseApiBaseUrl {
  if ($env:FLGET_RELEASE_API_BASE_URL) {
    return $env:FLGET_RELEASE_API_BASE_URL.TrimEnd("/")
  }
  return "https://api.github.com"
}

function Get-ReleaseOwner {
  if ($env:FLGET_RELEASE_OWNER) {
    return $env:FLGET_RELEASE_OWNER
  }
  return "flatina"
}

function Get-ReleaseRepo {
  if ($env:FLGET_RELEASE_REPO) {
    return $env:FLGET_RELEASE_REPO
  }
  return "flget"
}

function Get-BunDownloadBaseUrl {
  if ($env:FLGET_BUN_DOWNLOAD_BASE_URL) {
    return $env:FLGET_BUN_DOWNLOAD_BASE_URL.TrimEnd("/")
  }
  return "https://github.com/oven-sh/bun/releases/latest/download"
}

function Get-ReleaseHeaders {
  $headers = @{
    "Accept" = "application/vnd.github+json"
    "User-Agent" = "flget-update-script"
  }

  $token = if ($env:FLGET_GITHUB_TOKEN) {
    $env:FLGET_GITHUB_TOKEN
  } elseif ($env:GITHUB_TOKEN) {
    $env:GITHUB_TOKEN
  } else {
    $null
  }

  if ($token) {
    $headers["Authorization"] = "Bearer $token"
  }

  return $headers
}

function Get-ReleaseMetadata {
  param([string]$Tag)

  $ProgressPreference = "SilentlyContinue"
  $apiBase = Get-ReleaseApiBaseUrl
  $owner = Get-ReleaseOwner
  $repo = Get-ReleaseRepo
  $releasePath = if ($Tag) {
    "/repos/$owner/$repo/releases/tags/$([System.Uri]::EscapeDataString($Tag))"
  } else {
    "/repos/$owner/$repo/releases/latest"
  }

  return Invoke-RestMethod -Uri "$apiBase$releasePath" -Headers (Get-ReleaseHeaders)
}

function Get-ReleaseAssetUrl {
  param(
    [object]$Release,
    [string]$Name
  )

  if (-not $Release -or -not $Release.assets) {
    return $null
  }

  $asset = $Release.assets | Where-Object { $_.name -eq $Name } | Select-Object -First 1
  if (-not $asset) {
    return $null
  }

  return [string]$asset.browser_download_url
}

function Get-RequiredReleaseAssetUrl {
  param(
    [object]$Release,
    [string]$Name
  )

  $assetUrl = Get-ReleaseAssetUrl -Release $Release -Name $Name
  if (-not $assetUrl) {
    $releaseLabel = if ($Release -and $Release.tag_name) { $Release.tag_name } else { "requested release" }
    throw "Required release asset not found in ${releaseLabel}: $Name"
  }
  return $assetUrl
}

function Download-File {
  param(
    [string]$Url,
    [string]$OutFile
  )
  $ProgressPreference = "SilentlyContinue"
  Invoke-WebRequest -Uri $Url -OutFile $OutFile
}

function Expand-ArchiveSilent {
  param(
    [string]$Path,
    [string]$DestinationPath
  )
  $ProgressPreference = "SilentlyContinue"
  Expand-Archive -LiteralPath $Path -DestinationPath $DestinationPath -Force
}

function Expand-BunRuntime {
  param(
    [string]$ArchivePath,
    [string]$DestinationPath
  )

  $extractRoot = Join-Path $DestinationPath "bun-runtime"
  Expand-ArchiveSilent -Path $ArchivePath -DestinationPath $extractRoot
  $bunExe = Get-ChildItem -Path $extractRoot -Filter "bun.exe" -Recurse | Select-Object -First 1 -ExpandProperty FullName
  if (-not $bunExe) {
    throw "bun.exe not found in downloaded Bun archive"
  }
  Copy-Item -LiteralPath $bunExe -Destination (Join-Path $DestinationPath "bun.exe") -Force
}

function Invoke-WithRetry {
  param(
    [scriptblock]$Action,
    [string]$Description,
    [int]$Attempts = 40,
    [int]$DelayMs = 250
  )

  $lastError = $null
  for ($attempt = 1; $attempt -le $Attempts; $attempt += 1) {
    try {
      & $Action
      return
    } catch {
      $lastError = $_
      if ($attempt -eq $Attempts) {
        throw
      }
      Start-Sleep -Milliseconds $DelayMs
    }
  }

  if ($lastError) {
    throw $lastError
  }
}

function Invoke-EnvRefresh {
  param([string]$Root)

  $bunExe = Join-Path $Root "bun.exe"
  $cliPath = Join-Path $Root "flget.js"
  & $bunExe $cliPath cache refresh
  if ($LASTEXITCODE -ne 0) {
    throw "flget cache refresh failed with exit code ${LASTEXITCODE}"
  }
}

function Invoke-BucketBootstrap {
  param([string]$Root)

  $bunExe = Join-Path $Root "bun.exe"
  $cliPath = Join-Path $Root "flget.js"
  & $bunExe $cliPath bucket update | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "flget bucket update failed with exit code ${LASTEXITCODE}"
  }
}

function Invoke-CompatBootstrap {
  param([string]$Root)

  $bunExe = Join-Path $Root "bun.exe"
  $cliPath = Join-Path $Root "flget.js"
  & $bunExe $cliPath compat update | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "flget compat update failed with exit code ${LASTEXITCODE}"
  }
}

$resolvedRoot = [System.IO.Path]::GetFullPath($(if ($RootPath) { $RootPath } else { (Get-Location).Path }))
$normalizedBaseUrl = $BaseUrl.TrimEnd("/")

Ensure-Directory $resolvedRoot
Ensure-Directory (Join-Path $resolvedRoot "shims")
if (-not $ApplyDownloadedUpdate) {
  $launcherDir = Join-Path $resolvedRoot ("xdg\.local\state\flget\self-update\launcher-" + (New-SessionId))
  Ensure-Directory $launcherDir

  $latestScript = Join-Path $launcherDir "update.ps1"
  Write-Step "Downloading latest update script"
  Download-File -Url "$normalizedBaseUrl/update.ps1" -OutFile $latestScript

  & $latestScript -RootPath $resolvedRoot -BaseUrl $normalizedBaseUrl -ApplyDownloadedUpdate -ReleaseTag $ReleaseTag
  exit $LASTEXITCODE
}

$sessionDir = Join-Path $resolvedRoot ("xdg\.local\state\flget\self-update\session-" + (New-SessionId))
$newDir = Join-Path $sessionDir "new"
$oldDir = Join-Path $sessionDir "old"
$archiveExtract = Join-Path $sessionDir "runtime"
$cleanupSession = $true

Ensure-Directory $newDir
Ensure-Directory $oldDir

$rootFiles = @(
  "flget.js",
  "flget.js.map",
  "bun.exe",
  "activate.ps1",
  "update.ps1"
)

$movedOld = New-Object System.Collections.Generic.List[string]
$movedNew = New-Object System.Collections.Generic.List[string]

try {
  Write-Step "Preparing staged root update under $sessionDir"
  $release = Get-ReleaseMetadata -Tag $ReleaseTag
  $releaseLabel = if ($release.tag_name) { $release.tag_name } else { "latest release" }
  Write-Step "Using flget runtime assets from $releaseLabel"

  $runtimeArchive = Join-Path $sessionDir "flget-runtime.zip"
  Download-File -Url (Get-RequiredReleaseAssetUrl -Release $release -Name (Get-ReleaseArchiveName)) -OutFile $runtimeArchive
  Expand-ArchiveSilent -Path $runtimeArchive -DestinationPath $archiveExtract

  Write-Step "Downloading latest Bun runtime"
  $bunArchive = Join-Path $sessionDir "bun-runtime.zip"
  Download-File -Url "$(Get-BunDownloadBaseUrl)/$(Get-BunAssetName)" -OutFile $bunArchive
  Expand-BunRuntime -ArchivePath $bunArchive -DestinationPath $newDir

  foreach ($name in $rootFiles) {
    if ($name -eq "bun.exe") {
      continue
    }
    $sourcePath = Join-Path $archiveExtract $name
    if (-not (Test-Path -LiteralPath $sourcePath)) {
      throw "Required file missing from release archive: $name"
    }
    Move-Item -LiteralPath $sourcePath -Destination (Join-Path $newDir $name) -Force
  }

  Write-Step "Swapping root runtime files"
  foreach ($name in $rootFiles) {
    $currentPath = Join-Path $resolvedRoot $name
    if (Test-Path -LiteralPath $currentPath) {
      $backupPath = Join-Path $oldDir $name
      Invoke-WithRetry -Description "Moving $name to backup" -Action {
        Move-Item -LiteralPath $currentPath -Destination $backupPath -Force
      }
      [void]$movedOld.Add($name)
    }
  }

  foreach ($name in $rootFiles) {
    $stagedPath = Join-Path $newDir $name
    if (-not (Test-Path -LiteralPath $stagedPath)) {
      continue
    }
    $targetPath = Join-Path $resolvedRoot $name
    Invoke-WithRetry -Description "Installing $name" -Action {
      Move-Item -LiteralPath $stagedPath -Destination $targetPath -Force
    }
    [void]$movedNew.Add($name)
  }

  Write-Step "Refreshing root env caches"
  Invoke-EnvRefresh -Root $resolvedRoot
  try {
    Invoke-BucketBootstrap -Root $resolvedRoot
  } catch {
    Write-Warning "Initial bucket sync skipped: $($_.Exception.Message)"
  }
  try {
    Invoke-CompatBootstrap -Root $resolvedRoot
  } catch {
    Write-Warning "Initial compat sync skipped: $($_.Exception.Message)"
  }

  Write-Host ""
  Write-Host "flget updated at $resolvedRoot"
} catch {
  $cleanupSession = $false
  Write-Warning "Update failed. Rolling back previous root files."

  for ($index = $movedNew.Count - 1; $index -ge 0; $index -= 1) {
    $name = $movedNew[$index]
    $targetPath = Join-Path $resolvedRoot $name
    if (Test-Path -LiteralPath $targetPath) {
      Remove-Item -LiteralPath $targetPath -Force -ErrorAction SilentlyContinue
    }
  }

  for ($index = $movedOld.Count - 1; $index -ge 0; $index -= 1) {
    $name = $movedOld[$index]
    $backupPath = Join-Path $oldDir $name
    $targetPath = Join-Path $resolvedRoot $name
    if (-not (Test-Path -LiteralPath $backupPath)) {
      continue
    }
    Invoke-WithRetry -Description "Restoring $name" -Action {
      Move-Item -LiteralPath $backupPath -Destination $targetPath -Force
    }
  }

  throw
} finally {
  if ($cleanupSession) {
    Remove-Item -LiteralPath $sessionDir -Recurse -Force -ErrorAction SilentlyContinue
  } else {
    Write-Host "Preserved failed self-update session: $sessionDir"
  }
}
