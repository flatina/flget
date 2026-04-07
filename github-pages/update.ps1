#Requires -Version 5.1
param(
  [string]$BaseUrl = "https://flatina.github.io/flget",
  [string]$RootPath,
  [switch]$ApplyDownloadedUpdate,
  [switch]$ExternalBun
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version 3.0
$ProgressPreference = "SilentlyContinue"
$SCRIPT_VERSION = 1

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



function Get-BunDownloadName {
  $arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture
  switch ($arch.ToString()) {
    "Arm64" { return "bun-arm64.exe" }
    "X64" { return "bun.exe" }
    default { throw "Unsupported architecture: $arch" }
  }
}

function Download-File {
  param(
    [string]$Url,
    [string]$OutFile
  )
  $ProgressPreference = "SilentlyContinue"
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

function Test-EmbeddedBunMode {
  param([string]$Root)
  return Test-Path (Join-Path $Root "shims\bun.cmd")
}

function Resolve-Bun {
  param([string]$Root)

  $rootBun = Join-Path $Root "bun.exe"
  if (Test-Path $rootBun) {
    return [System.IO.Path]::GetFullPath($rootBun)
  }

  $parentBun = Join-Path (Split-Path -Parent $Root) "bun.exe"
  if (Test-Path $parentBun) {
    return [System.IO.Path]::GetFullPath($parentBun)
  }

  $bunCommand = Get-Command bun -ErrorAction SilentlyContinue
  if ($bunCommand) {
    return $bunCommand.Source
  }

  throw "bun.exe not found in the flget root, its parent directory, or PATH."
}

function Invoke-EnvRefresh {
  param([string]$Root)

  $bunExe = Resolve-Bun -Root $Root
  $cliPath = Join-Path $Root "flget.js"
  & $bunExe $cliPath cache refresh
  if ($LASTEXITCODE -ne 0) {
    throw "flget cache refresh failed with exit code ${LASTEXITCODE}"
  }
}

function Invoke-BucketBootstrap {
  param([string]$Root)

  $bucketDir = Join-Path $Root "gh\buckets"
  if ((Test-Path $bucketDir) -and (Get-ChildItem -LiteralPath $bucketDir -Filter "*.tar.gz" -File -ErrorAction SilentlyContinue | Select-Object -First 1)) {
    return
  }

  $bunExe = Resolve-Bun -Root $Root
  $cliPath = Join-Path $Root "flget.js"
  & $bunExe $cliPath bucket update | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "flget bucket update failed with exit code ${LASTEXITCODE}"
  }
}

function Invoke-CompatBootstrap {
  param([string]$Root)

  $compatDir = Join-Path $Root "gh\compat\official"
  if ((Test-Path $compatDir) -and (Get-ChildItem -LiteralPath $compatDir -Filter "*.tar.gz" -File -ErrorAction SilentlyContinue | Select-Object -First 1)) {
    return
  }

  $bunExe = Resolve-Bun -Root $Root
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

  & $latestScript -RootPath $resolvedRoot -BaseUrl $normalizedBaseUrl -ApplyDownloadedUpdate -ExternalBun:$ExternalBun
  exit $LASTEXITCODE
}

$sessionDir = Join-Path $resolvedRoot ("xdg\.local\state\flget\self-update\session-" + (New-SessionId))
$newDir = Join-Path $sessionDir "new"
$oldDir = Join-Path $sessionDir "old"
$cleanupSession = $true

Ensure-Directory $newDir
Ensure-Directory $oldDir

# Determine bun mode: -ExternalBun flag overrides; otherwise detect from existing shims
$isExistingInstall = Test-Path (Join-Path $resolvedRoot "flget.js")
$useEmbeddedBun = (-not $ExternalBun) -and ((-not $isExistingInstall) -or (Test-EmbeddedBunMode -Root $resolvedRoot))

$rootFiles = @("flget.js", "flget.js.map", "activate.ps1", "update.ps1")
if ($useEmbeddedBun) {
  $rootFiles += "bun.exe"
}

$movedOld = New-Object System.Collections.Generic.List[string]
$movedNew = New-Object System.Collections.Generic.List[string]

try {
  Write-Step "Downloading flget runtime files"
  foreach ($name in $rootFiles) {
    if ($name -eq "bun.exe") {
      continue
    }
    Download-File -Url "$normalizedBaseUrl/downloads/$name" -OutFile (Join-Path $newDir $name)
  }

  if ($useEmbeddedBun) {
    Write-Step "Downloading Bun runtime"
    Download-File -Url "$normalizedBaseUrl/downloads/$(Get-BunDownloadName)" -OutFile (Join-Path $newDir "bun.exe")
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

  if (-not $useEmbeddedBun) {
    # Verify external bun is available before cleaning up embedded artifacts
    $parentBun = Join-Path (Split-Path -Parent $resolvedRoot) "bun.exe"
    $hasFallbackBun = (Test-Path $parentBun) -or (Get-Command bun -ErrorAction SilentlyContinue)
    if (-not $hasFallbackBun) {
      throw "Cannot switch to external bun mode: no bun found in parent directory or PATH."
    }
    $bunExePath = Join-Path $resolvedRoot "bun.exe"
    if (Test-Path -LiteralPath $bunExePath) {
      Remove-Item -LiteralPath $bunExePath -Force
    }
    foreach ($shimName in @("bun.cmd", "bun.ps1")) {
      $shimPath = Join-Path $resolvedRoot "shims\$shimName"
      if (Test-Path -LiteralPath $shimPath) {
        Remove-Item -LiteralPath $shimPath -Force
      }
    }
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
