param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version 3.0
$ProgressPreference = "SilentlyContinue"

$repoRoot = (Resolve-Path "$PSScriptRoot\..").Path
$e2eRoot = "$repoRoot\tests\e2e"
$version = (Get-Content "$repoRoot\package.json" | ConvertFrom-Json).version
$expectedVersion = "flget $version"
$bunExe = (Get-Command bun -ErrorAction Stop).Source
$tmpRoot = "$([System.IO.Path]::GetTempPath())\flget-e2e-$([guid]::NewGuid().ToString('N'))"

function Wait-File($path, [int]$timeoutSeconds = 30) {
  $deadline = (Get-Date).AddSeconds($timeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-Path $path) {
      return
    }
    Start-Sleep -Milliseconds 100
  }
  throw "Timed out waiting for $path"
}

function Get-FreePort {
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
  $listener.Start()
  try {
    $listener.LocalEndpoint.Port
  } finally {
    $listener.Stop()
  }
}

function Read-Json($path) {
  return Get-Content $path | ConvertFrom-Json -AsHashtable
}

function Use-Env($envMap, [scriptblock]$action) {
  $entries = if ($envMap -is [System.Collections.IDictionary]) {
    $envMap.GetEnumerator() | ForEach-Object { @{ Name = [string]$_.Key; Value = [string]$_.Value } }
  } else {
    $envMap.PSObject.Properties | ForEach-Object { @{ Name = $_.Name; Value = [string]$_.Value } }
  }

  $before = @{}
  foreach ($entry in $entries) {
    $before[$entry.Name] = [Environment]::GetEnvironmentVariable($entry.Name, "Process")
    [Environment]::SetEnvironmentVariable($entry.Name, $entry.Value, "Process")
  }

  try {
    & $action
  } finally {
    foreach ($name in $before.Keys) {
      [Environment]::SetEnvironmentVariable($name, $before[$name], "Process")
    }
  }
}

New-Item -ItemType Directory -Path $tmpRoot | Out-Null

try {
  Write-Host "==> install-from-update-script"
  $scenarioRoot = "$tmpRoot\install-from-update-script"
  $installRoot = "$scenarioRoot\installed"
  $serverRoot = "$scenarioRoot\server"
  $setupJson = "$scenarioRoot\setup.json"
  $serverReady = "$scenarioRoot\server-ready.json"
  $port = Get-FreePort
  $baseUrl = "http://127.0.0.1:$port"
  New-Item -ItemType Directory -Force -Path $scenarioRoot | Out-Null

  & "$e2eRoot\install-from-update-script.setup.ps1" `
    -RepoRoot $repoRoot `
    -ServerRoot $serverRoot `
    -InstallRoot $installRoot `
    -BaseUrl $baseUrl `
    -ExpectedReleaseTag "v$version" `
    -BunExePath $bunExe `
    -OutFile $setupJson

  $staticServer = & {
    Set-Location $repoRoot
    bun run .\tests\mocks\static-file-server.ts --root $serverRoot --port $port --ready-file $serverReady
  } &

  Wait-File $serverReady
  try {
    $setup = Read-Json $setupJson
    Use-Env $setup.env {
      & "$e2eRoot\install-from-update-script.flow.ps1" `
        -BaseUrl $setup.baseUrl `
        -InstallRoot $setup.installRoot `
        -ExpectedVersionOutput $expectedVersion
    }
  } finally {
    $staticServer | Remove-Job -Force -ErrorAction SilentlyContinue
  }

  Write-Host "==> multi-source-user-workflow"
  $scenarioRoot = "$tmpRoot\multi-source"
  $installRoot = "$scenarioRoot\installed"
  $serverRoot = "$scenarioRoot\server"
  $setupJson = "$scenarioRoot\setup.json"
  $staticReady = "$scenarioRoot\static-ready.json"
  $githubReady = "$scenarioRoot\github-ready.json"
  $npmReady = "$scenarioRoot\npm-ready.json"
  $port = Get-FreePort
  $baseUrl = "http://127.0.0.1:$port"
  New-Item -ItemType Directory -Force -Path $scenarioRoot | Out-Null

  & "$e2eRoot\multi-source-user-workflow.setup.ps1" `
    -RepoRoot $repoRoot `
    -ServerRoot $serverRoot `
    -InstallRoot $installRoot `
    -BaseUrl $baseUrl `
    -ExpectedReleaseTag "v$version" `
    -BunExePath $bunExe `
    -OutFile $setupJson

  $setup = Read-Json $setupJson
  $staticServer = & {
    Set-Location $repoRoot
    bun run .\tests\mocks\static-file-server.ts --root $serverRoot --port $port --ready-file $staticReady
  } &
  $githubServer = & {
    Set-Location $repoRoot
    bun run .\tests\mocks\github-mock.ts --state $setup.githubStatePath --ready-file $githubReady
  } &
  $npmServer = & {
    Set-Location $repoRoot
    bun run .\tests\mocks\npm-registry-mock.ts --state $setup.npmStatePath --ready-file $npmReady
  } &

  Wait-File $staticReady
  Wait-File $githubReady
  Wait-File $npmReady
  try {
    $github = Read-Json $githubReady
    $npm = Read-Json $npmReady
    $envMap = @{}
    foreach ($entry in $setup.env.GetEnumerator()) {
      $envMap[$entry.Key] = $entry.Value
    }
    $envMap.FLGET_GITHUB_API_BASE_URL = $github.baseUrl
    $envMap.FLGET_NPM_REGISTRY_BASE_URL = $npm.baseUrl

    Use-Env $envMap {
      & "$e2eRoot\multi-source-user-workflow.flow.ps1" `
        -BaseUrl $setup.baseUrl `
        -InstallRoot $setup.installRoot `
        -ExpectedVersionOutput $expectedVersion `
        -GitHubApiBaseUrl $github.baseUrl `
        -NpmRegistryBaseUrl $npm.baseUrl
    }
  } finally {
    $staticServer | Remove-Job -Force -ErrorAction SilentlyContinue
    $githubServer | Remove-Job -Force -ErrorAction SilentlyContinue
    $npmServer | Remove-Job -Force -ErrorAction SilentlyContinue
  }

  Write-Host "==> shared-id-user-workflow"
  $scenarioRoot = "$tmpRoot\shared-id"
  $installRoot = "$scenarioRoot\installed"
  $serverRoot = "$scenarioRoot\server"
  $setupJson = "$scenarioRoot\setup.json"
  $staticReady = "$scenarioRoot\static-ready.json"
  $npmReady = "$scenarioRoot\npm-ready.json"
  $port = Get-FreePort
  $baseUrl = "http://127.0.0.1:$port"
  New-Item -ItemType Directory -Force -Path $scenarioRoot | Out-Null

  & "$e2eRoot\shared-id-user-workflow.setup.ps1" `
    -RepoRoot $repoRoot `
    -ServerRoot $serverRoot `
    -InstallRoot $installRoot `
    -BaseUrl $baseUrl `
    -ExpectedReleaseTag "v$version" `
    -BunExePath $bunExe `
    -OutFile $setupJson

  $setup = Read-Json $setupJson
  $staticServer = & {
    Set-Location $repoRoot
    bun run .\tests\mocks\static-file-server.ts --root $serverRoot --port $port --ready-file $staticReady
  } &
  $npmServer = & {
    Set-Location $repoRoot
    bun run .\tests\mocks\npm-registry-mock.ts --state $setup.npmStatePath --ready-file $npmReady
  } &

  Wait-File $staticReady
  Wait-File $npmReady
  try {
    $npm = Read-Json $npmReady
    $envMap = @{}
    foreach ($entry in $setup.env.GetEnumerator()) {
      $envMap[$entry.Key] = $entry.Value
    }
    $envMap.FLGET_NPM_REGISTRY_BASE_URL = $npm.baseUrl

    Use-Env $envMap {
      & "$e2eRoot\shared-id-user-workflow.flow.ps1" `
        -BaseUrl $setup.baseUrl `
        -InstallRoot $setup.installRoot `
        -ExpectedVersionOutput $expectedVersion `
        -NpmRegistryBaseUrl $npm.baseUrl `
        -BucketRepoPath $setup.bucketRepoPath `
        -Phase install
    }

    $npmServer | Remove-Job -Force -ErrorAction SilentlyContinue
    & "$e2eRoot\shared-id-user-workflow.promote.ps1" `
      -RepoRoot $repoRoot `
      -BaseUrl $setup.baseUrl `
      -BucketRepoPath $setup.bucketRepoPath `
      -NpmStatePath $setup.npmStatePath

    Remove-Item $npmReady -ErrorAction SilentlyContinue
    $npmServer = & {
      Set-Location $repoRoot
      bun run .\tests\mocks\npm-registry-mock.ts --state $setup.npmStatePath --ready-file $npmReady
    } &
    Wait-File $npmReady
    $npm = Read-Json $npmReady
    $envMap.FLGET_NPM_REGISTRY_BASE_URL = $npm.baseUrl

    Use-Env $envMap {
      & "$e2eRoot\shared-id-user-workflow.flow.ps1" `
        -BaseUrl $setup.baseUrl `
        -InstallRoot $setup.installRoot `
        -ExpectedVersionOutput $expectedVersion `
        -NpmRegistryBaseUrl $npm.baseUrl `
        -BucketRepoPath $setup.bucketRepoPath `
        -Phase update
    }
  } finally {
    $staticServer | Remove-Job -Force -ErrorAction SilentlyContinue
    $npmServer | Remove-Job -Force -ErrorAction SilentlyContinue
  }

  Write-Host "==> skills-selection-user-workflow"
  $scenarioRoot = "$tmpRoot\skills-selection"
  $installRoot = "$scenarioRoot\installed"
  $serverRoot = "$scenarioRoot\server"
  $setupJson = "$scenarioRoot\setup.json"
  $staticReady = "$scenarioRoot\static-ready.json"
  $githubReady = "$scenarioRoot\github-ready.json"
  $port = Get-FreePort
  $baseUrl = "http://127.0.0.1:$port"
  New-Item -ItemType Directory -Force -Path $scenarioRoot | Out-Null

  & "$e2eRoot\skills-selection-user-workflow.setup.ps1" `
    -RepoRoot $repoRoot `
    -ServerRoot $serverRoot `
    -InstallRoot $installRoot `
    -BaseUrl $baseUrl `
    -ExpectedReleaseTag "v$version" `
    -BunExePath $bunExe `
    -OutFile $setupJson

  $setup = Read-Json $setupJson
  $staticServer = & {
    Set-Location $repoRoot
    bun run .\tests\mocks\static-file-server.ts --root $serverRoot --port $port --ready-file $staticReady
  } &
  $githubServer = & {
    Set-Location $repoRoot
    bun run .\tests\mocks\github-mock.ts --state $setup.githubStatePath --ready-file $githubReady
  } &

  Wait-File $staticReady
  Wait-File $githubReady
  try {
    $github = Read-Json $githubReady
    $envMap = @{}
    foreach ($entry in $setup.env.GetEnumerator()) {
      $envMap[$entry.Key] = $entry.Value
    }
    $envMap.FLGET_GITHUB_API_BASE_URL = $github.baseUrl

    Use-Env $envMap {
      & "$e2eRoot\skills-selection-user-workflow.flow.ps1" `
        -BaseUrl $setup.baseUrl `
        -InstallRoot $setup.installRoot `
        -ExpectedVersionOutput $expectedVersion `
        -GitHubApiBaseUrl $github.baseUrl
    }
  } finally {
    $staticServer | Remove-Job -Force -ErrorAction SilentlyContinue
    $githubServer | Remove-Job -Force -ErrorAction SilentlyContinue
  }
} finally {
  Remove-Item $tmpRoot -Recurse -Force -ErrorAction SilentlyContinue
}
