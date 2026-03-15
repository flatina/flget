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
    [string]$FilePath,
    [string[]]$ArgumentList,
    [string]$WorkingDirectory,
    [string]$Label
  )

  Write-Host "==> $Label"
  Push-Location $WorkingDirectory
  try {
    & $FilePath @ArgumentList
    if ($LASTEXITCODE -ne 0) {
      throw "Command failed with exit code ${LASTEXITCODE}: $FilePath $($ArgumentList -join ' ')"
    }
  } finally {
    Pop-Location
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
