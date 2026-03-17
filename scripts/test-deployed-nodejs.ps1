param(
  [string]$RootPath,
  [switch]$SkipBuild,
  [switch]$KeepRoot
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version 3.0
$ProgressPreference = "SilentlyContinue"
. (Join-Path $PSScriptRoot "deployed-test-common.ps1")

$deployRoot = if ($RootPath) {
  [System.IO.Path]::GetFullPath($RootPath)
} else {
  Join-Path ([System.IO.Path]::GetTempPath()) ("flget-deployed-nodejs-" + [guid]::NewGuid().ToString("N"))
}

$cleanupRoot = -not $KeepRoot.IsPresent
$deployScript = Join-Path $PSScriptRoot "deploy.ps1"
$packageId = "nodejs"
$npmGlobalPackage = "rimraf"
$npxPackage = "@antfu/ni"

try {
  & $deployScript -RootPath $deployRoot -SkipBuild:$SkipBuild

  $expectedNodePath = Join-Path $deployRoot "scoop\$packageId\current\node.exe"
  $expectedPrefix = Join-Path $deployRoot "scoop\$packageId\current\bin"
  $expectedGlobalRoot = Join-Path $expectedPrefix "node_modules"
  $expectedGlobalCmd = Join-Path $expectedPrefix "$npmGlobalPackage.cmd"
  $expectedGlobalPackagePath = Join-Path $expectedGlobalRoot $npmGlobalPackage
  $expectedCache = Join-Path $deployRoot "scoop\$packageId\current\cache"
  $expectedNpxCache = Join-Path $expectedCache "_npx"

  Push-Location $deployRoot
  try {
    Write-Host "==> Activating deployed root"
    . .\activate.ps1

    $flgetCommand = Get-Command flget -ErrorAction Stop
    Assert-StartsWithPath $flgetCommand.Source $deployRoot "flget should resolve from the deployed root"

    Invoke-Checked { & $flgetCommand.Source --version }
    Invoke-Checked { & $flgetCommand.Source install $packageId --source scoop }

    Write-Host "==> Re-activating deployed root after install"
    . .\activate.ps1

    $nodePath = ((& where.exe node) | Select-Object -First 1).Trim()
    $npmPath = ((& where.exe npm) | Select-Object -First 1).Trim()
    $npxPath = ((& where.exe npx) | Select-Object -First 1).Trim()
    $bunCheckDir = Join-Path $deployRoot "tmp\bun-path-check"
    New-Item -ItemType Directory -Force -Path $bunCheckDir | Out-Null
    Push-Location $bunCheckDir
    try {
      $bunPath = (Get-Command bun -ErrorAction Stop).Source
    } finally {
      Pop-Location
    }
    Assert-EqualPath $nodePath $expectedNodePath "node should resolve from the deployed root"
    Assert-StartsWithPath $npmPath (Join-Path $deployRoot "scoop\$packageId\current") "npm should resolve from the deployed root"
    Assert-StartsWithPath $npxPath (Join-Path $deployRoot "scoop\$packageId\current") "npx should resolve from the deployed root"
    Assert-StartsWithPath $bunPath (Join-Path $deployRoot "shims") "bun should resolve from the deployed root"

    Write-Host "==> Checking node/npm runtime"
    bun --version
    node -v
    npm -v

    $npmPrefix = (npm config get prefix).Trim()
    $npmGlobalRoot = (npm root -g).Trim()
    $npmCache = (npm config get cache).Trim()
    Assert-EqualPath $npmPrefix $expectedPrefix "npm global prefix should stay inside the deployed root"
    Assert-EqualPath $npmGlobalRoot $expectedGlobalRoot "npm global root should stay inside the deployed root"
    Assert-EqualPath $npmCache $expectedCache "npm cache should stay inside the deployed root"

    Invoke-Checked { npm install -g $npmGlobalPackage }
    if (-not (Test-Path -LiteralPath $expectedGlobalCmd)) {
      throw "npm global shim was not created under the deployed root: $expectedGlobalCmd"
    }
    if (-not (Test-Path -LiteralPath $expectedGlobalPackagePath)) {
      throw "npm global package was not created under the deployed root: $expectedGlobalPackagePath"
    }

    Invoke-Checked { npx --yes $npxPackage --version }
    if (-not (Test-Path -LiteralPath $expectedNpxCache)) {
      throw "npx cache was not created under the deployed root: $expectedNpxCache"
    }
    $npxCacheEntry = Get-ChildItem -LiteralPath $expectedNpxCache -Force -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $npxCacheEntry) {
      throw "npx cache is empty under the deployed root: $expectedNpxCache"
    }

    Assert-InstalledPackageId -FlgetCommandPath $flgetCommand.Source -PackageId $packageId

    Write-Host "==> Deployed nodejs test passed"
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
