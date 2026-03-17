$ProgressPreference = "SilentlyContinue"

function Invoke-Checked {
  param(
    [scriptblock]$Action
  )

  $label = ($Action.ToString().Trim() -split "\r?\n" | Select-Object -First 1).Trim()
  Write-Host "==> $label"
  $global:LASTEXITCODE = 0
  & $Action
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code ${LASTEXITCODE}: $label"
  }
}

function Resolve-BunExe {
  $bunCommand = Get-Command bun -ErrorAction Stop
  $bunSource = $bunCommand.Source
  if ($bunSource -notlike "*.exe") {
    $candidate = Join-Path (Split-Path -Parent $bunSource) "bun.exe"
    if (Test-Path -LiteralPath $candidate) {
      $bunSource = $candidate
    }
  }
  if (-not (Test-Path -LiteralPath $bunSource)) {
    throw "bun executable not found: $bunSource"
  }
  return $bunSource
}
