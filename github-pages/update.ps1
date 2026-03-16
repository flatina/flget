#Requires -Version 5.1
[CmdletBinding()]
param(
  [string]$BaseUrl = "https://flatina.github.io/flget",
  [string]$RootPath,
  [switch]$ApplyDownloadedUpdate
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version 3.0

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

function Get-BunAssetName {
  $arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture
  switch ($arch.ToString()) {
    "Arm64" { return "bun-windows-aarch64.zip" }
    "X64" { return "bun-windows-x64.zip" }
    default { throw "Unsupported Windows architecture: $arch" }
  }
}

function Get-BunUrl {
  if ($env:FLGET_BUN_DOWNLOAD_URL) {
    return $env:FLGET_BUN_DOWNLOAD_URL
  }
  return "https://github.com/oven-sh/bun/releases/latest/download/$(Get-BunAssetName)"
}

function Download-File {
  param(
    [string]$Url,
    [string]$OutFile
  )
  Invoke-WebRequest -Uri $Url -OutFile $OutFile
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
  & $bunExe $cliPath env
  if ($LASTEXITCODE -ne 0) {
    throw "flget env failed with exit code ${LASTEXITCODE}"
  }
}

function Test-BucketBootstrapNeeded {
  param([string]$Root)

  $configPath = Join-Path $Root "flget.root.toml"
  if (-not (Test-Path -LiteralPath $configPath)) {
    return $true
  }

  $hasConfiguredBuckets = Select-String -LiteralPath $configPath -Pattern '^\s*\[\[buckets\]\]\s*$' -Quiet
  if (-not $hasConfiguredBuckets) {
    return $false
  }

  $bucketRoot = Join-Path $Root "buckets"
  if (-not (Test-Path -LiteralPath $bucketRoot)) {
    return $true
  }

  $bucketDir = Get-ChildItem -LiteralPath $bucketRoot -Directory -ErrorAction SilentlyContinue | Select-Object -First 1
  return $null -eq $bucketDir
}

function Invoke-BucketBootstrapIfNeeded {
  param([string]$Root)

  if (-not (Test-BucketBootstrapNeeded -Root $Root)) {
    return
  }

  $bunExe = Join-Path $Root "bun.exe"
  $cliPath = Join-Path $Root "flget.js"
  & $bunExe $cliPath bucket update | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "flget bucket update failed with exit code ${LASTEXITCODE}"
  }
}

$resolvedRoot = [System.IO.Path]::GetFullPath($(if ($RootPath) { $RootPath } else { (Get-Location).Path }))
$normalizedBaseUrl = $BaseUrl.TrimEnd("/")

Ensure-Directory $resolvedRoot
Ensure-Directory (Join-Path $resolvedRoot "shims")
Ensure-Directory (Join-Path $resolvedRoot "tmp")

if (-not $ApplyDownloadedUpdate) {
  $launcherDir = Join-Path $resolvedRoot ("tmp\\self-update\\launcher-" + [guid]::NewGuid().ToString("N"))
  Ensure-Directory $launcherDir

  $latestScript = Join-Path $launcherDir "update.ps1"
  Write-Step "Downloading latest update script"
  Download-File -Url "$normalizedBaseUrl/update.ps1" -OutFile $latestScript

  & $latestScript -RootPath $resolvedRoot -BaseUrl $normalizedBaseUrl -ApplyDownloadedUpdate
  exit $LASTEXITCODE
}

$sessionDir = Join-Path $resolvedRoot ("tmp\\self-update\\session-" + [guid]::NewGuid().ToString("N"))
$newDir = Join-Path $sessionDir "new"
$oldDir = Join-Path $sessionDir "old"
$bunExtract = Join-Path $sessionDir "bun"
$cleanupSession = $true

Ensure-Directory $newDir
Ensure-Directory $oldDir

$rootFiles = @(
  "flget.js",
  "flget.js.map",
  "bun.exe",
  "activate.ps1",
  "REGISTER_PATH.ps1",
  "update.ps1"
)

$assets = @(
  @{ Name = "flget.js"; Url = "$normalizedBaseUrl/dist/flget.js" },
  @{ Name = "flget.js.map"; Url = "$normalizedBaseUrl/dist/flget.js.map" },
  @{ Name = "activate.ps1"; Url = "$normalizedBaseUrl/activate.ps1" },
  @{ Name = "REGISTER_PATH.ps1"; Url = "$normalizedBaseUrl/REGISTER_PATH.ps1" },
  @{ Name = "update.ps1"; Url = "$normalizedBaseUrl/update.ps1" }
)

$movedOld = New-Object System.Collections.Generic.List[string]
$movedNew = New-Object System.Collections.Generic.List[string]

try {
  Write-Step "Preparing staged root update under $sessionDir"

  foreach ($asset in $assets) {
    Download-File -Url $asset.Url -OutFile (Join-Path $newDir $asset.Name)
  }

  Write-Step "Downloading Bun runtime"
  $bunZip = Join-Path $sessionDir "bun.zip"
  Download-File -Url (Get-BunUrl) -OutFile $bunZip
  Expand-Archive -LiteralPath $bunZip -DestinationPath $bunExtract -Force

  $downloadedBun = Get-ChildItem -Path $bunExtract -Filter bun.exe -Recurse | Select-Object -First 1 -ExpandProperty FullName
  if (-not $downloadedBun) {
    throw "bun.exe not found in downloaded archive."
  }
  Copy-Item -LiteralPath $downloadedBun -Destination (Join-Path $newDir "bun.exe") -Force

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
    Invoke-BucketBootstrapIfNeeded -Root $resolvedRoot
  } catch {
    Write-Warning "Initial bucket sync skipped: $($_.Exception.Message)"
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
