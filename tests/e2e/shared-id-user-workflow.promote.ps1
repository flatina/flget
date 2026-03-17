param(
  [string]$RepoRoot,
  [string]$BaseUrl,
  [string]$BucketRepoPath,
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

$manifestPath = Join-Path $BucketRepoPath "bucket\demo.json"
Write-Utf8NoBom -Path $manifestPath -Content ((New-ScoopManifestJson `
  -Version "2.0.0" `
  -Url "$($BaseUrl.TrimEnd('/'))/assets/demo-v2.cmd" `
  -Hash (Get-Sha256Hex (Join-Path $RepoRoot "tests\assets\scoop\demo-v2.cmd")) `
  -Target "demo-v2.cmd" `
  -ShimName "demo") + "`n")
& git -C $BucketRepoPath add .
& git -C $BucketRepoPath commit -m "demo v2" | Out-Null
