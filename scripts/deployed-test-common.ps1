$ProgressPreference = "SilentlyContinue"

function Assert-EqualPath {
  param(
    [string]$Actual,
    [string]$Expected,
    [string]$Message
  )

  $actualFull = [System.IO.Path]::GetFullPath($Actual)
  $expectedFull = [System.IO.Path]::GetFullPath($Expected)
  if (-not $actualFull.Equals($expectedFull, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "$Message`nExpected: $expectedFull`nActual:   $actualFull"
  }
}

function Assert-StartsWithPath {
  param(
    [string]$Actual,
    [string]$ExpectedPrefix,
    [string]$Message
  )

  $actualFull = [System.IO.Path]::GetFullPath($Actual)
  $expectedFull = [System.IO.Path]::GetFullPath($ExpectedPrefix)
  if (-not $actualFull.StartsWith($expectedFull, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "$Message`nExpected prefix: $expectedFull`nActual:          $actualFull"
  }
}

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

function Assert-InstalledPackageId {
  param(
    [string]$FlgetCommandPath,
    [string]$PackageId
  )

  $installedPackages = & $FlgetCommandPath list --json
  if ($LASTEXITCODE -ne 0) {
    throw "Unable to read installed package list."
  }
  $installedPackageList = $installedPackages | ConvertFrom-Json
  if (-not ($installedPackageList | Where-Object { $_.id -eq $PackageId })) {
    throw "Installed package list does not contain $PackageId."
  }
}
