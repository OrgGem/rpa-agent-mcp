#Requires -Version 7.2
param([string]$SnapshotPath = (Join-Path $PSScriptRoot 'snapshot.json'), [switch]$ValidateOnly)
$ErrorActionPreference = 'Stop'
$hostName = 'com.uipath.chromenativemsg_v2'
$subKey = 'Software\Google\Chrome\NativeMessagingHosts\' + $hostName
$allowedFiles = @('native-host.json','native-host.cmd','registration-before.json')
$snapshot = Get-Content -LiteralPath $SnapshotPath -Raw | ConvertFrom-Json
if ($snapshot.schemaVersion -ne 1 -or $snapshot.hostName -ne $hostName) { throw 'Invalid rollback snapshot.' }
$previousRoot = [IO.Path]::GetFullPath($snapshot.previousRoot)
$newRoot = [IO.Path]::GetFullPath($snapshot.newRoot)
$snapshotFolder = [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($SnapshotPath))
$workFolder = [IO.Path]::GetDirectoryName($snapshotFolder)
if ([IO.Path]::GetFileName($workFolder) -ne 'work' -or [IO.Path]::GetDirectoryName($workFolder) -ne $newRoot.TrimEnd('\')) { throw 'Snapshot location is not bound to checkout work/.' }
function Assert-NoReparsePoint([string]$Path) {
    $cursor = [IO.Path]::GetFullPath($Path)
    while ($cursor) {
        if (Test-Path -LiteralPath $cursor) {
            if (((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Reparse-point rollback path refused.' }
        }
        $parent = [IO.Path]::GetDirectoryName($cursor)
        if ($parent -eq $cursor) { break }; $cursor = $parent
    }
}
foreach ($p in @($SnapshotPath,$previousRoot,$newRoot)) { Assert-NoReparsePoint $p }
if ($previousRoot -eq $newRoot -or !(Test-Path -LiteralPath (Join-Path $previousRoot 'Setup.ps1')) -or !(Test-Path -LiteralPath (Join-Path $newRoot 'Setup.ps1'))) { throw 'Invalid checkout roots.' }
$allowedManifests = @((Join-Path $previousRoot 'native-host.json'), (Join-Path $newRoot 'native-host.json'))
# Validate every byte record and fixed target before the first write/delete.
foreach ($file in $snapshot.files) {
    if ($file.role -notin @('previous','new') -or $file.name -notin $allowedFiles) { throw 'Unexpected rollback file.' }
    $root = if ($file.role -eq 'previous') { $previousRoot } else { $newRoot }
    $target = [IO.Path]::GetFullPath((Join-Path $root $file.name))
    Assert-NoReparsePoint $target
    if ([IO.Path]::GetDirectoryName($target) -ne $root.TrimEnd('\')) { throw 'Rollback target escaped checkout.' }
    if ($file.existed) {
        $bytes = [Convert]::FromBase64String($file.contentBase64)
        $hash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()
        if ($hash -ne $file.sha256) { throw 'Rollback byte checksum mismatch.' }
    }
}
if (@($snapshot.files).Count -ne 6 -or @($snapshot.files | ForEach-Object { $_.role + '/' + $_.name } | Sort-Object -Unique).Count -ne 6) { throw 'Incomplete rollback file set.' }
if (@($snapshot.registrations).Count -ne 2 -or @($snapshot.registrations.view | Sort-Object -Unique).Count -ne 2) { throw 'Incomplete HKCU snapshot.' }
foreach ($row in $snapshot.registrations) {
    if ($row.view -notin @('Registry32','Registry64') -or ($row.existed -and ($row.manifest -ne $allowedManifests[0] -or $row.kind -ne 'String'))) { throw 'Invalid original registration.' }
}
foreach ($hive in @([Microsoft.Win32.RegistryHive]::CurrentUser,[Microsoft.Win32.RegistryHive]::LocalMachine)) {
    foreach ($view in @([Microsoft.Win32.RegistryView]::Registry32,[Microsoft.Win32.RegistryView]::Registry64)) {
        $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey($hive,$view)
        $key = $base.OpenSubKey($subKey)
        try {
            if ($key -and ($hive -eq [Microsoft.Win32.RegistryHive]::LocalMachine -or $key.GetValue('') -notin $allowedManifests -or $key.GetValueKind('') -ne [Microsoft.Win32.RegistryValueKind]::String -or $key.SubKeyCount -ne 0 -or @($key.GetValueNames() | Where-Object { $_ -ne '' }).Count)) { throw 'Unrelated registration; rollback refused.' }
        } finally { if ($key) { $key.Dispose() }; $base.Dispose() }
    }
}
if ($ValidateOnly) { Write-Output 'Rollback snapshot, checksums, fixed targets and registration ownership validated; no changes.'; return }
foreach ($file in $snapshot.files) {
    $root = if ($file.role -eq 'previous') { $previousRoot } else { $newRoot }
    $target = Join-Path $root $file.name
    if ($file.existed) { [IO.File]::WriteAllBytes($target, [Convert]::FromBase64String($file.contentBase64)) }
    elseif (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Force }
}
foreach ($file in $snapshot.files) {
    $root = if ($file.role -eq 'previous') { $previousRoot } else { $newRoot }
    $target = Join-Path $root $file.name
    if ($file.existed) {
        if (!(Test-Path -LiteralPath $target -PathType Leaf) -or (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ne $file.sha256) { throw 'Restored file readback mismatch.' }
    } elseif (Test-Path -LiteralPath $target) { throw 'Generated-file removal readback mismatch.' }
}
foreach ($row in $snapshot.registrations) {
    $view = [Microsoft.Win32.RegistryView]::$($row.view)
    $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser,$view)
    try {
        if ($row.existed) {
            $key = $base.CreateSubKey($subKey)
            try { $key.SetValue('', $row.manifest, [Microsoft.Win32.RegistryValueKind]::String) } finally { $key.Dispose() }
        } else { $base.DeleteSubKey($subKey,$false) }
    } finally { $base.Dispose() }
}
foreach ($row in $snapshot.registrations) {
    $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser,[Microsoft.Win32.RegistryView]::$($row.view))
    $key = $base.OpenSubKey($subKey)
    try { if (($row.existed -and (!$key -or $key.GetValue('') -ne $row.manifest)) -or (!$row.existed -and $key)) { throw 'Rollback registry readback mismatch.' } }
    finally { if ($key) { $key.Dispose() }; $base.Dispose() }
}
[ordered]@{rolledBackAt=(Get-Date -Format o);registryReadbackPassed=$true;reconnectRequired=$true} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path (Split-Path $SnapshotPath) 'rollback-result.json')
Write-Output 'Original generated files and HKCU registration restored. Toggle UiPath extension to reconnect if the new host had started.'
