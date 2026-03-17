$ProgressPreference = "SilentlyContinue"

$targetBin = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "shims"))
$current = [Environment]::GetEnvironmentVariable("Path", "User")
$parts = @()
if ($current) {
  $parts = $current -split ";" | Where-Object { $_ }
}

$normalizedTargetBin = $targetBin.TrimEnd("\")
$filtered = New-Object System.Collections.Generic.List[string]
foreach ($part in $parts) {
  $trimmed = $part.Trim()
  if (-not $trimmed) {
    continue
  }

  $normalizedPart = $trimmed.TrimEnd("\")
  if ($normalizedPart -ieq $normalizedTargetBin) {
    continue
  }

  if ((Split-Path -Leaf $normalizedPart) -ieq "shims") {
    $candidateRoot = Split-Path -Parent $normalizedPart
    if (
      (Test-Path (Join-Path $candidateRoot "flget.js")) -and
      (Test-Path (Join-Path $candidateRoot "bun.exe")) -and
      (Test-Path (Join-Path $candidateRoot "flget.root.toml"))
    ) {
      continue
    }
  }

  $filtered.Add($trimmed)
}

$next = @($targetBin) + $filtered
[Environment]::SetEnvironmentVariable("Path", ($next -join ";"), "User")

Write-Host "Registered flget from $targetBin"
Write-Host "Open a new shell to use the updated PATH."
