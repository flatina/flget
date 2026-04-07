#Requires -Version 7.0
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
    if (Test-Path $path) { return }
    Start-Sleep -Milliseconds 100
  }
  throw "Timed out waiting for $path"
}

function Get-FreePort {
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
  $listener.Start()
  try { $listener.LocalEndpoint.Port } finally { $listener.Stop() }
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

function New-Scenario([string]$name) {
  Write-Host "==> $name"
  $root = "$tmpRoot\$name"
  New-Item -ItemType Directory -Force -Path $root | Out-Null
  $port = Get-FreePort

  & "$e2eRoot\$name.setup.ps1" `
    -RepoRoot $repoRoot `
    -ServerRoot "$root\server" `
    -InstallRoot "$root\installed" `
    -BaseUrl "http://127.0.0.1:$port" `
    -BunExePath $bunExe `
    -OutFile "$root\setup.json"

  return @{ root = $root; port = $port; setup = (Read-Json "$root\setup.json") }
}

function Start-Mock([string]$script, [string]$readyFile, [string[]]$mockArgs) {
  Remove-Item $readyFile -ErrorAction SilentlyContinue
  $job = & {
    Set-Location $repoRoot
    bun run ".\tests\mocks\$script" @mockArgs --ready-file $readyFile
  } &
  Wait-File $readyFile
  return @{ job = $job; info = (Read-Json $readyFile) }
}

New-Item -ItemType Directory -Path $tmpRoot | Out-Null

try {
  $s = New-Scenario "install-from-update-script"
  $static = Start-Mock "static-file-server" "$($s.root)\static-ready.json" @("--root", "$($s.root)\server", "--port", "$($s.port)")
  try {
    Use-Env $s.setup.env {
      & "$e2eRoot\install-from-update-script.flow.ps1" `
        -BaseUrl $s.setup.baseUrl `
        -InstallRoot $s.setup.installRoot `
        -ExpectedVersionOutput $expectedVersion
    }
  } finally {
    $static.job | Remove-Job -Force -ErrorAction SilentlyContinue
  }

  $s = New-Scenario "multi-source-user-workflow"
  $static = Start-Mock "static-file-server" "$($s.root)\static-ready.json" @("--root", "$($s.root)\server", "--port", "$($s.port)")
  $github = Start-Mock "github-mock" "$($s.root)\github-ready.json" @("--state", $s.setup.githubStatePath)
  $npm = Start-Mock "npm-registry-mock" "$($s.root)\npm-ready.json" @("--state", $s.setup.npmStatePath)
  try {
    $envMap = $s.setup.env.Clone()
    $envMap.FLGET_GITHUB_API_BASE_URL = $github.info.baseUrl
    $envMap.FLGET_NPM_REGISTRY_BASE_URL = $npm.info.baseUrl
    Use-Env $envMap {
      & "$e2eRoot\multi-source-user-workflow.flow.ps1" `
        -BaseUrl $s.setup.baseUrl `
        -InstallRoot $s.setup.installRoot `
        -ExpectedVersionOutput $expectedVersion `
        -GitHubApiBaseUrl $github.info.baseUrl `
        -NpmRegistryBaseUrl $npm.info.baseUrl
    }
  } finally {
    $static.job, $github.job, $npm.job | Remove-Job -Force -ErrorAction SilentlyContinue
  }

  $s = New-Scenario "shared-id-user-workflow"
  $static = Start-Mock "static-file-server" "$($s.root)\static-ready.json" @("--root", "$($s.root)\server", "--port", "$($s.port)")
  $npm = Start-Mock "npm-registry-mock" "$($s.root)\npm-ready.json" @("--state", $s.setup.npmStatePath)
  try {
    $envMap = $s.setup.env.Clone()
    $envMap.FLGET_NPM_REGISTRY_BASE_URL = $npm.info.baseUrl
    Use-Env $envMap {
      & "$e2eRoot\shared-id-user-workflow.flow.ps1" `
        -BaseUrl $s.setup.baseUrl `
        -InstallRoot $s.setup.installRoot `
        -ExpectedVersionOutput $expectedVersion `
        -NpmRegistryBaseUrl $npm.info.baseUrl `
        -Phase install
    }

    $npm.job | Remove-Job -Force -ErrorAction SilentlyContinue
    & "$e2eRoot\shared-id-user-workflow.promote.ps1" `
      -RepoRoot $repoRoot `
      -BaseUrl $s.setup.baseUrl `
      -InstallRoot $s.setup.installRoot `
      -NpmStatePath $s.setup.npmStatePath

    $npm = Start-Mock "npm-registry-mock" "$($s.root)\npm-ready.json" @("--state", $s.setup.npmStatePath)
    $envMap.FLGET_NPM_REGISTRY_BASE_URL = $npm.info.baseUrl
    Use-Env $envMap {
      & "$e2eRoot\shared-id-user-workflow.flow.ps1" `
        -BaseUrl $s.setup.baseUrl `
        -InstallRoot $s.setup.installRoot `
        -ExpectedVersionOutput $expectedVersion `
        -NpmRegistryBaseUrl $npm.info.baseUrl `
        -Phase update
    }
  } finally {
    $static.job, $npm.job | Remove-Job -Force -ErrorAction SilentlyContinue
  }

  $s = New-Scenario "skills-selection-user-workflow"
  $static = Start-Mock "static-file-server" "$($s.root)\static-ready.json" @("--root", "$($s.root)\server", "--port", "$($s.port)")
  $github = Start-Mock "github-mock" "$($s.root)\github-ready.json" @("--state", $s.setup.githubStatePath)
  try {
    $envMap = $s.setup.env.Clone()
    $envMap.FLGET_GITHUB_API_BASE_URL = $github.info.baseUrl
    Use-Env $envMap {
      & "$e2eRoot\skills-selection-user-workflow.flow.ps1" `
        -BaseUrl $s.setup.baseUrl `
        -InstallRoot $s.setup.installRoot `
        -ExpectedVersionOutput $expectedVersion `
        -GitHubApiBaseUrl $github.info.baseUrl
    }
  } finally {
    $static.job, $github.job | Remove-Job -Force -ErrorAction SilentlyContinue
  }

  $s = New-Scenario "depot-local-workflow"
  $static = Start-Mock "static-file-server" "$($s.root)\static-ready.json" @("--root", "$($s.root)\server", "--port", "$($s.port)")
  try {
    Use-Env $s.setup.env {
      & "$e2eRoot\depot-local-workflow.flow.ps1" `
        -BaseUrl $s.setup.baseUrl `
        -InstallRoot $s.setup.installRoot `
        -ExpectedVersionOutput $expectedVersion `
        -DepotRoot $s.setup.depotRoot
    }
  } finally {
    $static.job | Remove-Job -Force -ErrorAction SilentlyContinue
  }

  $s = New-Scenario "depot-serve-workflow"
  $static = Start-Mock "static-file-server" "$($s.root)\static-ready.json" @("--root", "$($s.root)\server", "--port", "$($s.port)")
  $depotServePort = Get-FreePort
  try {
    Use-Env $s.setup.env {
      & "$e2eRoot\depot-serve-workflow.flow.ps1" `
        -BaseUrl $s.setup.baseUrl `
        -InstallRoot $s.setup.installRoot `
        -ExpectedVersionOutput $expectedVersion `
        -DepotRoot $s.setup.depotRoot `
        -DepotServePort $depotServePort
    }
  } finally {
    $static.job | Remove-Job -Force -ErrorAction SilentlyContinue
  }
} finally {
  Remove-Item $tmpRoot -Recurse -Force -ErrorAction SilentlyContinue
}
