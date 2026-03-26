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

# Create a second root (depot server) with runtime files
$depotRoot = Join-Path (Split-Path -Parent $InstallRoot) "depot-server"
Ensure-Directory $depotRoot
foreach ($file in @("flget.js", "flget.js.map")) {
  Copy-Item -LiteralPath (Join-Path $RepoRoot "dist\$file") -Destination (Join-Path $depotRoot $file) -Force
}
foreach ($file in @("activate.ps1", "update.ps1")) {
  Copy-Item -LiteralPath (Join-Path $RepoRoot "github-pages\$file") -Destination (Join-Path $depotRoot $file) -Force
}
Copy-Item -LiteralPath $BunExePath -Destination (Join-Path $depotRoot "bun.exe") -Force
Set-Content -LiteralPath (Join-Path $depotRoot "flget.root.toml") -Encoding UTF8 -Value "version = 1"

# Pre-install a scoop package into depot root
$pkgDir = Join-Path $depotRoot "scoop\fldemo\current"
Ensure-Directory $pkgDir
Set-Content -LiteralPath (Join-Path $pkgDir "fldemo.cmd") -Encoding ASCII -Value "@echo serve-fldemo-1.0.0"
Set-Content -LiteralPath (Join-Path $depotRoot "scoop\fldemo\flget.meta.json") -Encoding UTF8 -Value (@{
  displayName = "fldemo"
  sourceRef = "scoop:main/fldemo"
  resolvedVersion = "1.0.0"
  resolvedRef = "1.0.0"
  portability = "portable"
  runtime = "standalone"
  bin = @(@{ name = "fldemo"; target = "fldemo.cmd"; type = "cmd" })
  persist = @()
  warnings = @()
  notes = $null
} | ConvertTo-Json -Depth 6)

$result = @{
  baseUrl = $setup.baseUrl
  installRoot = $setup.installRoot
  depotRoot = $depotRoot
  env = $setup.env
}

Ensure-Directory (Split-Path -Parent ([System.IO.Path]::GetFullPath($OutFile)))
Write-Utf8NoBom -Path ([System.IO.Path]::GetFullPath($OutFile)) -Content ($result | ConvertTo-Json -Depth 12)
