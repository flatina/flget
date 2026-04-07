$ProgressPreference = "SilentlyContinue"
$SCRIPT_VERSION = 1

function Resolve-FlgetBun {
  $rootBun = Join-Path $PSScriptRoot "bun.exe"
  if (Test-Path $rootBun) {
    return [System.IO.Path]::GetFullPath($rootBun)
  }

  $parentBun = Join-Path (Split-Path -Parent $PSScriptRoot) "bun.exe"
  if (Test-Path $parentBun) {
    return [System.IO.Path]::GetFullPath($parentBun)
  }

  $bunCommand = Get-Command bun -ErrorAction SilentlyContinue
  if ($bunCommand) {
    return $bunCommand.Source
  }

  return $null
}

function Test-BucketBootstrapNeeded {
  # If bucket tarballs already exist, no bootstrap needed
  $bucketRoot = Join-Path $PSScriptRoot "gh\buckets"
  if ((Test-Path -LiteralPath $bucketRoot)) {
    $bucketFile = Get-ChildItem -LiteralPath $bucketRoot -Filter "*.tar.gz" -File -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -ne $bucketFile) {
      return $false
    }
  }

  $configPath = Join-Path $PSScriptRoot "flget.root.toml"
  if (-not (Test-Path -LiteralPath $configPath)) {
    return $true
  }

  $hasConfiguredBuckets = Select-String -LiteralPath $configPath -Pattern '^\s*\[\[buckets\]\]\s*$' -Quiet
  return [bool]$hasConfiguredBuckets
}

$env:FL_ROOT = $PSScriptRoot
$resolvedBun = Resolve-FlgetBun

if (-not $resolvedBun) {
  Write-Error "bun.exe not found in the flget root, its parent directory, or PATH."
  exit 1
}

New-Item -ItemType Directory -Force -Path "$PSScriptRoot\shims" | Out-Null
if (-not (Test-Path "$PSScriptRoot\shims\flget.cmd")) {
  Set-Content -LiteralPath "$PSScriptRoot\shims\flget.cmd" -Encoding ASCII -Value @"
@echo off
setlocal
set "SHIMDIR=%~dp0"
set "BUN=%SHIMDIR%\..\bun.exe"
if not exist "%BUN%" set "BUN=%SHIMDIR%\..\..\bun.exe"
if exist "%BUN%" goto run
where bun >nul 2>nul
if errorlevel 1 (
  echo bun.exe not found in the flget root, its parent directory, or PATH. 1>&2
  exit /b 1
)
set "BUN=bun"
:run
if "%BUN%"=="bun" (
  bun "%SHIMDIR%\..\flget.js" %*
) else (
  "%BUN%" "%SHIMDIR%\..\flget.js" %*
)
"@
}
if (-not (Test-Path "$PSScriptRoot\shims\flget.ps1")) {
  Set-Content -LiteralPath "$PSScriptRoot\shims\flget.ps1" -Encoding ASCII -Value @'
$rootBun = Join-Path $PSScriptRoot "..\bun.exe"
$parentBun = Join-Path $PSScriptRoot "..\..\bun.exe"
if (Test-Path $rootBun) {
  $bun = [System.IO.Path]::GetFullPath($rootBun)
} elseif (Test-Path $parentBun) {
  $bun = [System.IO.Path]::GetFullPath($parentBun)
} else {
  $bunCommand = Get-Command bun -ErrorAction SilentlyContinue
  if (-not $bunCommand) {
    Write-Error "bun.exe not found in the flget root, its parent directory, or PATH."
    exit 1
  }
  $bun = $bunCommand.Source
}
& $bun "$PSScriptRoot\..\flget.js" @args
exit $LASTEXITCODE
'@
}
if (-not (Test-Path "$PSScriptRoot\shims\bun.cmd")) {
  Set-Content -LiteralPath "$PSScriptRoot\shims\bun.cmd" -Encoding ASCII -Value @"
@echo off
setlocal
set "SHIMDIR=%~dp0"
set "BUN=%SHIMDIR%\..\bun.exe"
if not exist "%BUN%" set "BUN=%SHIMDIR%\..\..\bun.exe"
if exist "%BUN%" goto run
where bun >nul 2>nul
if errorlevel 1 (
  echo bun.exe not found in the flget root, its parent directory, or PATH. 1>&2
  exit /b 1
)
set "BUN=bun"
:run
if "%BUN%"=="bun" (
  bun %*
) else (
  "%BUN%" %*
)
"@
}
if (-not (Test-Path "$PSScriptRoot\shims\bun.ps1")) {
  Set-Content -LiteralPath "$PSScriptRoot\shims\bun.ps1" -Encoding ASCII -Value @'
$rootBun = Join-Path $PSScriptRoot "..\bun.exe"
$parentBun = Join-Path $PSScriptRoot "..\..\bun.exe"
if (Test-Path $rootBun) {
  $bun = [System.IO.Path]::GetFullPath($rootBun)
} elseif (Test-Path $parentBun) {
  $bun = [System.IO.Path]::GetFullPath($parentBun)
} else {
  $bunCommand = Get-Command bun -ErrorAction SilentlyContinue
  if (-not $bunCommand) {
    Write-Error "bun.exe not found in the flget root, its parent directory, or PATH."
    exit 1
  }
  $bun = $bunCommand.Source
}
& $bun @args
exit $LASTEXITCODE
'@
}

if (Test-Path "$PSScriptRoot\flget.js") {
  $configPath = Join-Path $PSScriptRoot "flget.root.toml"
  if (-not (Test-Path -LiteralPath $configPath)) {
    & $resolvedBun "$PSScriptRoot\flget.js" config create | Out-Null
  }
  if (Test-BucketBootstrapNeeded) {
    try {
      & $resolvedBun "$PSScriptRoot\flget.js" bucket update | Out-Null
    } catch {
    }
  }
}

$env:FL_ACTIVE = "1"
$env:PATH = "$env:FL_ROOT\shims;$env:PATH"

$pathCache = Join-Path $PSScriptRoot "xdg\.local\state\flget\cache-env-paths.txt"
if (Test-Path $pathCache) {
  foreach ($line in Get-Content -LiteralPath $pathCache) {
    if ($line) {
      $env:PATH = "$env:FL_ROOT\$line;$env:PATH"
    }
  }
}

$setCache = Join-Path $PSScriptRoot "xdg\.local\state\flget\cache-env-sets.txt"
if (Test-Path $setCache) {
  foreach ($line in Get-Content -LiteralPath $setCache) {
    if (-not $line) { continue }
    $parts = $line -split "=", 2
    if ($parts.Count -eq 2 -and $parts[0]) {
      Set-Item -Path ("Env:{0}" -f $parts[0]) -Value $parts[1]
    }
  }
}

$env:XDG_CONFIG_HOME = "$env:FL_ROOT\xdg\.config"
$env:XDG_DATA_HOME   = "$env:FL_ROOT\xdg\.local\share"
$env:XDG_STATE_HOME  = "$env:FL_ROOT\xdg\.local\state"
$env:XDG_CACHE_HOME  = "$env:FL_ROOT\xdg\.cache"
