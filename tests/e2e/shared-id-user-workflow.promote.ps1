param(
  [string]$RepoRoot,
  [string]$BaseUrl,
  [string]$InstallRoot,
  [string]$NpmStatePath
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version 3.0
$ProgressPreference = "SilentlyContinue"
. "$PSScriptRoot\..\helpers\e2e-setup-common.ps1"

$demoV2Archive = Join-Path (Split-Path -Parent $NpmStatePath) "demo-2.0.0.tgz"
New-TarGzArchive -StageRoot (Join-Path $RepoRoot "tests\assets\npm\demo-v2") -ArchivePath $demoV2Archive

$npmState = Get-Content $NpmStatePath | ConvertFrom-Json -AsHashtable
$npmState.packages.demo.latest = "2.0.0"
$npmState.packages.demo.versions["2.0.0"] = $demoV2Archive
Write-Utf8NoBom -Path $NpmStatePath -Content ($npmState | ConvertTo-Json -Depth 12)

# Recreate the local bucket tarball with v2 manifest
$stateRoot = Split-Path -Parent $NpmStatePath
$bucketStageDir = Join-Path $stateRoot "bucket-local-v2-stage\Local-HEAD\bucket"
Ensure-Directory $bucketStageDir
Write-Utf8NoBom -Path (Join-Path $bucketStageDir "demo.json") -Content ((New-ScoopManifestJson `
  -Version "2.0.0" `
  -Url "$($BaseUrl.TrimEnd('/'))/assets/demo-v2.cmd" `
  -Hash (Get-Sha256Hex (Join-Path $RepoRoot "tests\assets\scoop\demo-v2.cmd")) `
  -Target "demo-v2.cmd" `
  -ShimName "demo") + "`n")
$localBucketTarball = Join-Path $stateRoot "bucket-local-v2.tar.gz"
New-TarGzArchive -StageRoot (Join-Path $stateRoot "bucket-local-v2-stage\Local-HEAD") -ArchivePath $localBucketTarball

# Replace the installed bucket tarball
$installBucketDir = Join-Path $InstallRoot "gh\buckets"
Copy-Item -LiteralPath $localBucketTarball -Destination (Join-Path $installBucketDir "local.tar.gz") -Force
