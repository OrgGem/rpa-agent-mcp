param(
  [ValidateSet('Status', 'Register', 'Unregister')]
  [string]$Action = 'Status',
  [string]$HostManifestPath = (Join-Path (Split-Path $PSScriptRoot -Parent) 'work/companion-unpacked/com.uipath.companion_v1.json')
)

$ErrorActionPreference = 'Stop'
$hostName = 'com.uipath.companion_v1'
$subKey = "Software\Google\Chrome\NativeMessagingHosts\$hostName"
$manifestPath = [IO.Path]::GetFullPath($HostManifestPath)

function Get-CompanionRegistrations {
  $rows = @()
  foreach ($viewName in @('Registry32', 'Registry64')) {
    $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, [Microsoft.Win32.RegistryView]::$viewName)
    $key = $base.OpenSubKey($subKey, $false)
    try {
      if ($null -ne $key) {
        $value = $key.GetValue('')
        $extraValues = @($key.GetValueNames() | Where-Object { $_ -ne '' })
        $rows += [pscustomobject]@{
          view = $viewName
          manifest = if ($null -eq $value) { $null } else { [string]$value }
          extraValues = $extraValues
          subKeyCount = $key.SubKeyCount
        }
      }
    } finally {
      if ($null -ne $key) { $key.Dispose() }
      $base.Dispose()
    }
  }
  return $rows
}

$registrations = @(Get-CompanionRegistrations)
if ($Action -eq 'Status') {
  if ($registrations.Count -eq 0) {
    [pscustomobject]@{ action = $Action; state = 'not-registered'; host = $hostName }
  } elseif (@($registrations | Where-Object { $_.manifest -and [IO.Path]::GetFullPath($_.manifest) -ieq $manifestPath -and $_.extraValues.Count -eq 0 -and $_.subKeyCount -eq 0 }).Count -eq $registrations.Count) {
    [pscustomobject]@{ action = $Action; state = 'registered-here'; host = $hostName; registrations = $registrations }
  } else {
    [pscustomobject]@{ action = $Action; state = 'conflicting-registration'; host = $hostName; registrations = $registrations }
  }
  return
}

if ($Action -eq 'Register') {
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw "Build the companion package first: $manifestPath" }
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  if ($manifest.name -ne $hostName -or $manifest.type -ne 'stdio' -or
      $manifest.allowed_origins.Count -ne 1 -or $manifest.allowed_origins[0] -ne 'chrome-extension://dppcppnipbmolajgbbackncmhgejpena/') {
    throw 'Native host manifest identity or extension allowlist is invalid.'
  }
  foreach ($row in $registrations) {
    if (-not $row.manifest -or [IO.Path]::GetFullPath($row.manifest) -ine $manifestPath -or $row.extraValues.Count -gt 0 -or $row.subKeyCount -gt 0) {
      throw "Refusing to replace or adopt a conflicting native host registration in $($row.view)."
    }
  }
  foreach ($viewName in @('Registry32', 'Registry64')) {
    if (@($registrations | Where-Object { $_.view -eq $viewName }).Count -gt 0) { continue }
    $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, [Microsoft.Win32.RegistryView]::$viewName)
    $key = $base.CreateSubKey($subKey)
    try { $key.SetValue('', $manifestPath, [Microsoft.Win32.RegistryValueKind]::String) }
    finally { $key.Dispose(); $base.Dispose() }
  }
  [pscustomobject]@{ action = $Action; state = 'registered-here'; host = $hostName; manifest = $manifestPath; views = @('Registry32', 'Registry64') }
  return
}

foreach ($row in $registrations) {
  if (-not $row.manifest -or [IO.Path]::GetFullPath($row.manifest) -ine $manifestPath -or $row.extraValues.Count -gt 0 -or $row.subKeyCount -gt 0) {
    throw "Refusing to remove a different or extended native host registration in $($row.view)."
  }
}
foreach ($row in $registrations) {
  $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, [Microsoft.Win32.RegistryView]::$($row.view))
  try { $base.DeleteSubKey($subKey, $false) } finally { $base.Dispose() }
}
[pscustomobject]@{ action = $Action; state = 'unregistered'; host = $hostName; views = @($registrations | ForEach-Object { $_.view }) }
