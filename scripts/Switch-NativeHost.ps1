#Requires -Version 7.2
param([Parameter(Mandatory)][string]$PreviousRoot, [string]$SnapshotDirectory, [switch]$Apply)
$ErrorActionPreference = 'Stop'
$newRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path.TrimEnd('\')
$previous = (Resolve-Path -LiteralPath $PreviousRoot).Path.TrimEnd('\')
if ($previous -eq $newRoot) { throw 'Previous and new checkout must differ.' }
foreach ($name in @('Setup.ps1','native-host.json','native-host.cmd')) {
    if (!(Test-Path -LiteralPath (Join-Path $previous $name) -PathType Leaf)) { throw "Previous checkout is missing $name" }
}
$manifest = Get-Content -LiteralPath (Join-Path $previous 'native-host.json') -Raw | ConvertFrom-Json
if ($manifest.name -ne 'com.uipath.chromenativemsg_v2' -or $manifest.path -ne (Join-Path $previous 'native-host.cmd') -or $manifest.type -ne 'stdio' -or @($manifest.allowed_origins).Count -ne 1 -or $manifest.allowed_origins[0] -ne 'chrome-extension://jfcmnbofjlffnejneillkgbniiidiigd/') { throw 'Previous manifest is not this prototype.' }
$subKey = 'Software\Google\Chrome\NativeMessagingHosts\com.uipath.chromenativemsg_v2'
$registrations = @()
foreach ($hive in @([Microsoft.Win32.RegistryHive]::CurrentUser,[Microsoft.Win32.RegistryHive]::LocalMachine)) {
    foreach ($view in @([Microsoft.Win32.RegistryView]::Registry32,[Microsoft.Win32.RegistryView]::Registry64)) {
        $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey($hive,$view)
        $key = $base.OpenSubKey($subKey)
        try {
            if ($key -and ($hive -eq [Microsoft.Win32.RegistryHive]::LocalMachine -or $key.GetValue('') -ne (Join-Path $previous 'native-host.json') -or $key.GetValueKind('') -ne [Microsoft.Win32.RegistryValueKind]::String -or $key.SubKeyCount -ne 0 -or @($key.GetValueNames() | Where-Object { $_ -ne '' }).Count)) { throw 'Registration does not belong to supplied previous prototype.' }
            if ($hive -eq [Microsoft.Win32.RegistryHive]::CurrentUser) { $registrations += [pscustomobject]@{view=$view.ToString();existed=($null -ne $key);manifest=if($key){$key.GetValue('')}else{$null};kind=if($key){$key.GetValueKind('').ToString()}else{$null}} }
        } finally { if ($key) { $key.Dispose() }; $base.Dispose() }
    }
}
if (@($registrations | Where-Object existed).Count -eq 0) { throw 'No previous owned registration found.' }
$workRoot = [IO.Path]::GetFullPath((Join-Path $newRoot 'work'))
if (!$SnapshotDirectory) { $SnapshotDirectory = Join-Path $workRoot ('host-transition-' + (Get-Date -Format yyyyMMdd-HHmmss) + '-' + [Guid]::NewGuid().ToString('N').Substring(0,8)) }
$SnapshotDirectory = [IO.Path]::GetFullPath($SnapshotDirectory)
if (!$SnapshotDirectory.StartsWith($workRoot + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Snapshot must be inside checkout work/.' }
$snapshotPath = Join-Path $SnapshotDirectory 'snapshot.json'
if (!(Test-Path -LiteralPath $snapshotPath)) {
    if (Test-Path -LiteralPath $SnapshotDirectory) { throw 'Snapshot folder already exists without a snapshot.' }
    New-Item -ItemType Directory -Path $SnapshotDirectory | Out-Null
    $files = @()
    foreach ($role in @('previous','new')) {
        $root = if ($role -eq 'previous') { $previous } else { $newRoot }
        foreach ($name in @('native-host.json','native-host.cmd','registration-before.json')) {
            $p = Join-Path $root $name; $exists = Test-Path -LiteralPath $p -PathType Leaf
            [byte[]]$bytes = @()
            if ($exists) { $bytes = [IO.File]::ReadAllBytes($p) }
            $files += [pscustomobject]@{role=$role;name=$name;existed=$exists;contentBase64=[Convert]::ToBase64String($bytes);sha256=if($exists){[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()}else{$null}}
        }
    }
    [ordered]@{schemaVersion=1;hostName='com.uipath.chromenativemsg_v2';capturedAt=(Get-Date -Format o);previousRoot=$previous;newRoot=$newRoot;previousSetupSha256=(Get-FileHash -LiteralPath (Join-Path $previous 'Setup.ps1') -Algorithm SHA256).Hash;registrations=$registrations;files=$files} |
        ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $snapshotPath -Encoding UTF8
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Restore-NativeHost.ps1') -Destination (Join-Path $SnapshotDirectory 'Rollback.ps1')
}
$snapshot = Get-Content -LiteralPath $snapshotPath -Raw | ConvertFrom-Json
if ($snapshot.previousRoot -ne $previous -or $snapshot.newRoot -ne $newRoot -or $snapshot.previousSetupSha256 -ne (Get-FileHash -LiteralPath (Join-Path $previous 'Setup.ps1') -Algorithm SHA256).Hash) { throw 'Snapshot does not match the supplied checkouts.' }
& (Join-Path $SnapshotDirectory 'Rollback.ps1') -ValidateOnly
Write-Output "Rollback prepared: $SnapshotDirectory"
if (!$Apply) { return }
try {
    & (Join-Path $previous 'Setup.ps1') -Mode Uninstall
    & (Join-Path $newRoot 'Setup.ps1') -Mode Install -EnableG0Probe
    foreach ($view in @([Microsoft.Win32.RegistryView]::Registry32,[Microsoft.Win32.RegistryView]::Registry64)) {
        $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser,$view);$key=$base.OpenSubKey($subKey)
        try { if (!$key -or $key.GetValue('') -ne (Join-Path $newRoot 'native-host.json')) { throw 'Applied registry readback mismatch.' } }
        finally { if ($key) { $key.Dispose() }; $base.Dispose() }
    }
    [ordered]@{appliedAt=(Get-Date -Format o);registryReadbackPassed=$true;probeEnabled=$true;reconnectRequired=$true} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $SnapshotDirectory 'apply-result.json')
    Write-Output 'New registration verified. Existing native process is unchanged until extension reconnect.'
} catch {
    $applyError = $_
    & (Join-Path $SnapshotDirectory 'Rollback.ps1')
    throw $applyError
}
