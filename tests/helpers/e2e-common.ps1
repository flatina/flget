$ProgressPreference = "SilentlyContinue"

function Invoke-Checked {
  param(
    [scriptblock]$Action,
    [string[]]$ExpectContains = @()
  )

  $label = ($Action.ToString().Trim() -split "\r?\n" | Select-Object -First 1).Trim()
  Write-Host "==> $label"
  $global:LASTEXITCODE = 0
  $output = (& $Action 2>&1 | Out-String)
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code ${LASTEXITCODE}: $label`n$output"
  }

  foreach ($needle in $ExpectContains) {
    if ($output -notlike "*$needle*") {
      throw "Expected output for '$label' to contain '$needle'`n$output"
    }
  }

  return $output
}

function Invoke-ExpectedFailure {
  param(
    [scriptblock]$Action,
    [string[]]$ExpectContains = @()
  )

  $label = ($Action.ToString().Trim() -split "\r?\n" | Select-Object -First 1).Trim()
  Write-Host "==> $label"
  $global:LASTEXITCODE = 0
  $failed = $false
  try {
    $output = (& $Action 2>&1 | Out-String)
    if ($LASTEXITCODE -ne 0) {
      $failed = $true
    }
  } catch {
    $failed = $true
    $output = ($_ | Out-String)
  }

  if (-not $failed) {
    throw "Expected command to fail: $label`n$output"
  }

  foreach ($needle in $ExpectContains) {
    if ($output -notlike "*$needle*") {
      throw "Expected failure output for '$label' to contain '$needle'`n$output"
    }
  }

  return $output
}
